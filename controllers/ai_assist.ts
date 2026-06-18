import { asc, desc, eq, and, isNotNull } from 'drizzle-orm';
import { ErrorResponse } from '../common/errors';
import { getPostgresDb } from '../database';
import { asyncHandler } from '../middlewares/error-handler';
import {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} from '../drizzle/schema/schema';
import aiAssistOrchestrator from '../services/ai-assist/orchestrator';
import {
  normalizeStudentPickerRow,
  requireAccessibleStudent,
  searchAccessibleStudents
} from '../services/ai-assist/tools';
import { getAccessibleStudentFilter } from '../services/ai-assist/studentAccess';
import {
  buildOverview,
  PORTFOLIO_BUCKET_LIMIT
} from '../services/ai-assist/overview';
import { withPostgresRetry } from '../services/ai-assist/postgresRetry';
import { openAIClient, OpenAiModel } from '../services/openai';
import logger from '../services/logger';
import StudentService from '../services/students';

const DEFAULT_TITLE = 'New AI Assist conversation';
const ACTIVE_STATUS = 'active';
const ARCHIVED_STATUS = 'archived';
const RECENT_CONVERSATION_BATCH_SIZE = 50;
const MAX_RECENT_UNIQUE_STUDENTS = 25;
const STUDENT_PICKER_FIELDS =
  'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors applying_program_count';

const currentUserId = (req) => req.user?._id?.toString();

const VALID_AI_ASSIST_SKILLS = new Set([
  'summarize_student',
  'identify_risk',
  'review_messages',
  'review_messages_recent',
  'review_messages_all',
  'review_document_threads',
  'summarize_lead_meetings',
  'review_open_tasks'
]);
const AUTO_TITLE_MAX_LENGTH = 56;
const AUTO_TITLE_MODEL = OpenAiModel.GPT_5_4_nano || 'gpt-5.4-nano';
const AUTO_TITLE_INSTRUCTIONS =
  'Generate one concise conversation title for internal staff usage. Use plain text only, no quotes, no markdown, no IDs. Keep it short and specific.';
const SKILL_TITLE_LABELS = Object.freeze({
  summarize_student: 'Student summary',
  identify_risk: 'Application risk check',
  review_messages: 'Message review',
  review_messages_recent: 'Recent message summary',
  review_messages_all: 'All message summary',
  review_document_threads: 'Document thread review',
  summarize_lead_meetings: 'Lead meeting summary',
  review_open_tasks: 'Open task review'
});

const lower = (value) => String(value || '').toLowerCase();

const extractOpenAiErrorMetadata = (error) => ({
  status:
    Number(error?.status) ||
    Number(error?.statusCode) ||
    Number(error?.error?.status) ||
    null,
  code: lower(
    error?.code || error?.type || error?.error?.code || error?.error?.type
  ),
  message: error?.error?.message || error?.message || ''
});

const mapAiAssistExecutionError = (error) => {
  if (error instanceof ErrorResponse) {
    return null;
  }

  const metadata = extractOpenAiErrorMetadata(error);
  const message = lower(metadata.message);
  const isLikelyOpenAiError =
    Boolean(metadata.status) ||
    Boolean(metadata.code) ||
    message.includes('openai') ||
    message.includes('api key') ||
    message.includes('quota');

  if (!isLikelyOpenAiError) {
    return null;
  }

  const invalidKey =
    metadata.status === 401 ||
    metadata.code.includes('invalid_api_key') ||
    metadata.code.includes('incorrect_api_key') ||
    message.includes('api key') ||
    message.includes('not valid') ||
    message.includes('not provided');

  if (invalidKey) {
    return {
      statusCode: 502,
      clientMessage: 'AI Assist is temporarily unavailable. Please try again.',
      warningDetail: metadata.message || metadata.code || 'OpenAI invalid key'
    };
  }

  const quotaExceeded =
    metadata.status === 429 ||
    metadata.code.includes('insufficient_quota') ||
    metadata.code.includes('quota') ||
    message.includes('quota') ||
    message.includes('rate limit');

  if (quotaExceeded) {
    return {
      statusCode: 503,
      clientMessage: 'AI Assist is temporarily unavailable. Please try again.',
      warningDetail:
        metadata.message || metadata.code || 'OpenAI quota exceeded'
    };
  }

  return {
    statusCode: 502,
    clientMessage: 'AI Assist is temporarily unavailable. Please try again.',
    warningDetail: metadata.message || metadata.code || 'OpenAI request failed'
  };
};

const normalizeAutoTitle = (value) =>
  String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AUTO_TITLE_MAX_LENGTH);

const escapeRegExp = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripAssistTokens = (message = '', assistContext = {}) => {
  let plain = String(message || '');
  const displayName = assistContext?.mentionedStudent?.displayName;

  if (displayName) {
    plain = plain.replace(
      new RegExp(`@${escapeRegExp(displayName)}`, 'gi'),
      ' '
    );
  }

  return plain
    .replace(/#[a-z_]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const resolveSkillLabel = (assistContext = {}, assistantResult = {}) =>
  SKILL_TITLE_LABELS[assistContext.requestedSkill] ||
  SKILL_TITLE_LABELS[assistantResult?.skillTrace?.requestedSkill] ||
  null;

const resolveTitleStudentName = (assistContext = {}, assistantResult = {}) =>
  assistantResult?.activeStudent?.displayName ||
  assistantResult?.activeStudent?.name ||
  assistContext?.mentionedStudent?.displayName ||
  assistantResult?.skillTrace?.student?.displayName ||
  null;

const buildRuleBasedTitle = ({
  message,
  assistContext = {},
  assistantResult = {}
}) => {
  const studentName = normalizeAutoTitle(
    resolveTitleStudentName(assistContext, assistantResult)
  );
  const skillLabel = normalizeAutoTitle(
    resolveSkillLabel(assistContext, assistantResult)
  );
  const plainMessage = normalizeAutoTitle(
    stripAssistTokens(message, assistContext)
  );

  if (studentName && skillLabel) {
    return normalizeAutoTitle(`${studentName} · ${skillLabel}`);
  }

  if (studentName) {
    return studentName;
  }

  if (skillLabel) {
    return skillLabel;
  }

  return plainMessage || DEFAULT_TITLE;
};

const shouldAllowAutoTitleUpdate = (conversation = {}) => {
  if (conversation.titleUpdatedByUser === true) {
    return false;
  }

  if (conversation.titleAutoGenerated === false) {
    return false;
  }

  if (
    conversation.titleAutoGenerated == null &&
    conversation.title &&
    conversation.title !== DEFAULT_TITLE
  ) {
    return false;
  }

  return true;
};

const resolveAssistContextPayload = async (req) => {
  const raw = req.body?.assistContext;
  if (!raw) {
    return undefined;
  }

  if (raw.mentionedStudent?.id) {
    await requireAccessibleStudent(req, raw.mentionedStudent.id);
  }

  const requestedSkill = VALID_AI_ASSIST_SKILLS.has(raw.requestedSkill)
    ? raw.requestedSkill
    : null;

  return {
    mentionedStudent: raw.mentionedStudent?.id
      ? {
          id: raw.mentionedStudent.id,
          displayName: raw.mentionedStudent.displayName || null
        }
      : null,
    requestedSkill,
    unknownSkillText:
      raw.requestedSkill && !requestedSkill
        ? raw.requestedSkill
        : raw.unknownSkillText || null,
    // When true, the orchestrator injects the structured deep-dive output
    // format (HEALTH / BLOCKERS / RISKS / ACTIONS / ANALYSIS) the frontend
    // AnalysisDisplay parses. Sent by the Student Analysis view.
    analysisMode: Boolean(raw.analysisMode)
  };
};

const resolvePreferredLanguage = (req) => {
  const preferredLanguage = req.body?.preferredLanguage;

  return typeof preferredLanguage === 'string' && preferredLanguage.trim()
    ? preferredLanguage.trim()
    : 'en';
};

const isStreamingRequest = (req) => {
  const streamQuery = String(req.query?.stream || '').toLowerCase();
  if (streamQuery === '1' || streamQuery === 'true') {
    return true;
  }

  return String(req.headers?.accept || '')
    .toLowerCase()
    .includes('text/event-stream');
};

const initSse = (res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
};

const writeSse = (res, event, payload) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const requireActiveConversationOwner = async (
  postgres,
  conversationId,
  userId
) => {
  const rows = await postgres
    .select()
    .from(aiAssistConversations)
    .where(
      and(
        eq(aiAssistConversations.id, conversationId),
        eq(aiAssistConversations.ownerUserId, userId),
        eq(aiAssistConversations.status, ACTIVE_STATUS)
      )
    )
    .limit(1);

  if (!rows.length) {
    throw new ErrorResponse(404, 'AI Assist conversation not found');
  }

  return rows[0];
};

const updateOwnedActiveConversation = async (
  postgres,
  conversationId,
  userId,
  values
) => {
  const rows = await postgres
    .update(aiAssistConversations)
    .set(values)
    .where(
      and(
        eq(aiAssistConversations.id, conversationId),
        eq(aiAssistConversations.ownerUserId, userId),
        eq(aiAssistConversations.status, ACTIVE_STATUS)
      )
    )
    .returning();

  if (!rows.length) {
    throw new ErrorResponse(404, 'AI Assist conversation not found');
  }

  return rows[0];
};

const buildConversationUpdateValues = ({
  conversation = {},
  message = '',
  assistContext = {},
  assistantResult = {}
}) => {
  const values = {
    updatedAt: new Date()
  };
  const activeStudent = assistantResult.activeStudent;

  if (activeStudent?.id) {
    values.studentId = activeStudent.id;
    values.studentDisplayName =
      activeStudent.displayName || activeStudent.name || null;
  }

  if (shouldAllowAutoTitleUpdate(conversation)) {
    const autoTitle = buildRuleBasedTitle({
      message,
      assistContext,
      assistantResult
    });

    if (autoTitle && autoTitle !== conversation.title) {
      values.title = autoTitle;
      values.titleAutoGenerated = true;
      values.titleGeneratedAt = new Date();
    }
  }

  return values;
};

const queueAiTitleRefinement = ({
  conversationId,
  ownerUserId,
  seedTitle,
  message,
  assistContext,
  assistantResult
}) => {
  if (
    process.env.NODE_ENV === 'test' ||
    !conversationId ||
    !ownerUserId ||
    !seedTitle ||
    !openAIClient.responses?.create
  ) {
    return;
  }

  setTimeout(async () => {
    try {
      const studentName = resolveTitleStudentName(
        assistContext,
        assistantResult
      );
      const skillLabel = resolveSkillLabel(assistContext, assistantResult);
      const response = await openAIClient.responses.create({
        model: AUTO_TITLE_MODEL,
        instructions: AUTO_TITLE_INSTRUCTIONS,
        input: [
          {
            role: 'user',
            content: JSON.stringify(
              {
                message: stripAssistTokens(message, assistContext),
                student: studentName || null,
                skill: skillLabel || null,
                currentTitle: seedTitle
              },
              null,
              2
            )
          }
        ]
      });
      const aiTitle = normalizeAutoTitle(response.output_text || '');

      if (!aiTitle || aiTitle === seedTitle) {
        return;
      }

      const postgres = getPostgresDb();
      await postgres
        .update(aiAssistConversations)
        .set({
          title: aiTitle,
          titleAutoGenerated: true,
          titleGeneratedAt: new Date(),
          updatedAt: new Date()
        })
        .where(
          and(
            eq(aiAssistConversations.id, conversationId),
            eq(aiAssistConversations.ownerUserId, ownerUserId),
            eq(aiAssistConversations.status, ACTIVE_STATUS),
            eq(aiAssistConversations.titleUpdatedByUser, false),
            eq(aiAssistConversations.title, seedTitle)
          )
        );
    } catch (error) {
      logger.warn(
        `[AI Assist] title refinement skipped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }, 0);
};

const insertConversationRecord = async (db, req, extraValues = {}) => {
  const providedTitle =
    typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const hasManualTitle = Boolean(providedTitle);

  return db
    .insert(aiAssistConversations)
    .values({
      ownerUserId: currentUserId(req),
      ownerRole: req.user.role,
      title: hasManualTitle ? providedTitle : DEFAULT_TITLE,
      titleAutoGenerated: !hasManualTitle,
      titleUpdatedByUser: hasManualTitle,
      status: ACTIVE_STATUS,
      ...extraValues
    })
    .returning();
};

const createConversationRecord = async (postgres, req, extraValues = {}) => {
  const ownerUserId = currentUserId(req);

  return withPostgresRetry(
    () => insertConversationRecord(postgres, req, extraValues),
    {
      operation: 'ai_assist_create_conversation',
      ownerUserId
    }
  );
};

const createConversation = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  const [conversation] = await createConversationRecord(postgres, req);

  res.status(201).send({
    success: true,
    data: conversation
  });
});

const listConversations = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  const conversations = await postgres
    .select()
    .from(aiAssistConversations)
    .where(
      and(
        eq(aiAssistConversations.ownerUserId, currentUserId(req)),
        eq(aiAssistConversations.status, ACTIVE_STATUS)
      )
    )
    .orderBy(desc(aiAssistConversations.updatedAt))
    .limit(25);

  res.status(200).send({
    success: true,
    data: conversations
  });
});

const listRecentStudents = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  const recentStudentIds = [];
  const recentConversationByStudentId = new Map();
  let offset = 0;

  while (recentStudentIds.length < MAX_RECENT_UNIQUE_STUDENTS) {
    const conversations = await postgres
      .select()
      .from(aiAssistConversations)
      .where(
        and(
          eq(aiAssistConversations.ownerUserId, currentUserId(req)),
          eq(aiAssistConversations.status, ACTIVE_STATUS),
          isNotNull(aiAssistConversations.studentId)
        )
      )
      .orderBy(desc(aiAssistConversations.updatedAt))
      .offset(offset)
      .limit(RECENT_CONVERSATION_BATCH_SIZE);

    if (!conversations.length) {
      break;
    }

    for (const conversation of conversations) {
      if (recentStudentIds.length >= MAX_RECENT_UNIQUE_STUDENTS) {
        break;
      }

      const studentId =
        conversation.studentId?.toString?.() || conversation.studentId;
      if (!studentId || recentConversationByStudentId.has(studentId)) {
        continue;
      }

      recentStudentIds.push(studentId);
      recentConversationByStudentId.set(studentId, conversation);
    }

    if (conversations.length < RECENT_CONVERSATION_BATCH_SIZE) {
      break;
    }

    offset += conversations.length;
  }

  if (!recentStudentIds.length) {
    res.status(200).send({
      success: true,
      data: []
    });
    return;
  }

  const filter = await getAccessibleStudentFilter(req);
  const students = await StudentService.findStudentsSelect(
    {
      ...filter,
      _id: { $in: recentStudentIds }
    },
    STUDENT_PICKER_FIELDS,
    recentStudentIds.length
  );

  const studentsById = new Map(
    students.map((student) => [
      student._id?.toString?.() || student.id,
      student
    ])
  );
  const data = recentStudentIds
    .map((studentId) => {
      const student = studentsById.get(studentId);
      if (!student) {
        return null;
      }

      const conversation = recentConversationByStudentId.get(studentId);
      return {
        ...normalizeStudentPickerRow(student),
        conversationId: conversation.id,
        studentDisplayName: conversation.studentDisplayName || undefined
      };
    })
    .filter(Boolean);

  res.status(200).send({
    success: true,
    data
  });
});

const getOverview = asyncHandler(async (req, res) => {
  const days = Number(req.query?.days) || undefined;
  // The portfolio view needs the full at-risk list (not the small chat sample)
  // so triage does not silently drop students beyond the first few per bucket.
  const overview = await buildOverview(req, {
    deadlineWindowDays: days,
    sampleSize: PORTFOLIO_BUCKET_LIMIT
  });

  res.status(200).send({
    success: true,
    data: overview
  });
});

const getLatestStudentAnalysis = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  // Access check: 404s if the student is not visible to this user.
  await requireAccessibleStudent(req, studentId);

  const postgres = getPostgresDb();
  const [conversation] = await postgres
    .select()
    .from(aiAssistConversations)
    .where(
      and(
        eq(aiAssistConversations.ownerUserId, currentUserId(req)),
        eq(aiAssistConversations.studentId, studentId),
        eq(aiAssistConversations.analysisMode, true),
        eq(aiAssistConversations.status, ACTIVE_STATUS)
      )
    )
    .orderBy(desc(aiAssistConversations.updatedAt))
    .limit(1);

  if (!conversation) {
    res.status(200).send({ success: true, data: null });
    return;
  }

  const [assistantMessage] = await postgres
    .select()
    .from(aiAssistMessages)
    .where(
      and(
        eq(aiAssistMessages.conversationId, conversation.id),
        eq(aiAssistMessages.role, 'assistant')
      )
    )
    .orderBy(desc(aiAssistMessages.createdAt))
    .limit(1);

  res.status(200).send({
    success: true,
    data: assistantMessage
      ? {
          conversationId: conversation.id,
          content: assistantMessage.content,
          analyzedAt: assistantMessage.createdAt,
          conversation
        }
      : null
  });
});

const listMyStudents = asyncHandler(async (req, res) => {
  const filter = await getAccessibleStudentFilter(req);
  const students = await StudentService.findStudentsSelect(
    filter,
    STUDENT_PICKER_FIELDS,
    25
  );

  res.status(200).send({
    success: true,
    data: students.map(normalizeStudentPickerRow)
  });
});

const searchStudents = asyncHandler(async (req, res) => {
  const result = await searchAccessibleStudents(req, {
    query: req.query?.q,
    limit: req.query?.limit
  });

  res.status(200).send({
    success: true,
    data: result.data
  });
});

const getConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const postgres = getPostgresDb();
  const conversation = await requireActiveConversationOwner(
    postgres,
    conversationId,
    currentUserId(req)
  );
  const messages = await postgres
    .select()
    .from(aiAssistMessages)
    .where(eq(aiAssistMessages.conversationId, conversationId))
    .orderBy(asc(aiAssistMessages.createdAt));
  const trace = await postgres
    .select()
    .from(aiAssistToolCalls)
    .where(eq(aiAssistToolCalls.conversationId, conversationId))
    .orderBy(asc(aiAssistToolCalls.createdAt));

  res.status(200).send({
    success: true,
    data: {
      conversation,
      messages,
      trace
    }
  });
});

const archiveConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const postgres = getPostgresDb();
  const conversation = await updateOwnedActiveConversation(
    postgres,
    conversationId,
    currentUserId(req),
    {
      status: ARCHIVED_STATUS,
      updatedAt: new Date()
    }
  );

  res.status(200).send({
    success: true,
    data: conversation
  });
});

const updateConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const title = req.body?.title?.trim();

  if (!title) {
    throw new ErrorResponse(400, 'Conversation title is required');
  }

  const postgres = getPostgresDb();
  const conversation = await updateOwnedActiveConversation(
    postgres,
    conversationId,
    currentUserId(req),
    {
      title,
      titleAutoGenerated: false,
      titleUpdatedByUser: true,
      updatedAt: new Date()
    }
  );

  res.status(200).send({
    success: true,
    data: conversation
  });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    throw new ErrorResponse(400, 'message is required');
  }
  const preferredLanguage = resolvePreferredLanguage(req);
  const assistContext = await resolveAssistContextPayload(req);
  let titleRefinementPayload = null;

  if (isStreamingRequest(req)) {
    const postgres = getPostgresDb();
    initSse(res);

    try {
      // Verify conversation before starting (fast read, no transaction needed).
      const conversation = await requireActiveConversationOwner(
        postgres,
        conversationId,
        currentUserId(req)
      );

      // Run AI outside any DB transaction — tool loops can take minutes and
      // would exceed any reasonable statement/transaction timeout.
      const assistantResult = await aiAssistOrchestrator.runAiAssist(postgres, {
        conversationId,
        message,
        assistContext,
        preferredLanguage,
        req,
        onProgress: async (event) => {
          writeSse(res, 'progress', event);
        },
        onToken: async (text) => {
          writeSse(res, 'token', { text });
        }
      });

      const conversationUpdates = buildConversationUpdateValues({
        conversation,
        message,
        assistContext,
        assistantResult
      });
      await updateOwnedActiveConversation(
        postgres,
        conversationId,
        currentUserId(req),
        conversationUpdates
      );
      if (conversationUpdates.title) {
        titleRefinementPayload = {
          conversationId,
          ownerUserId: currentUserId(req),
          seedTitle: conversationUpdates.title,
          message,
          assistContext,
          assistantResult
        };
      }

      writeSse(res, 'final', {
        success: true,
        data: assistantResult
      });
      writeSse(res, 'done', { ok: true });
      queueAiTitleRefinement(titleRefinementPayload || {});
    } catch (error) {
      logger.error('[AI Assist] streaming sendMessage failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      const mappedError = mapAiAssistExecutionError(error);
      const detail =
        process.env.NODE_ENV !== 'production' && error instanceof Error
          ? error.message
          : undefined;
      if (mappedError) {
        writeSse(res, 'error', {
          message: mappedError.clientMessage,
          detail
        });
      } else {
        writeSse(res, 'error', {
          message:
            error instanceof Error
              ? error.message
              : 'AI Assist streaming failed'
        });
      }
    } finally {
      res.end();
    }

    return;
  }

  const postgres = getPostgresDb();
  let result;
  try {
    result = await postgres.transaction(async (tx) => {
      const conversation = await requireActiveConversationOwner(
        tx,
        conversationId,
        currentUserId(req)
      );

      const assistantResult = await aiAssistOrchestrator.runAiAssist(tx, {
        conversationId,
        message,
        assistContext,
        preferredLanguage,
        req
      });
      const conversationUpdates = buildConversationUpdateValues({
        conversation,
        message,
        assistContext,
        assistantResult
      });

      await updateOwnedActiveConversation(
        tx,
        conversationId,
        currentUserId(req),
        conversationUpdates
      );
      if (conversationUpdates.title) {
        titleRefinementPayload = {
          conversationId,
          ownerUserId: currentUserId(req),
          seedTitle: conversationUpdates.title,
          message,
          assistContext,
          assistantResult
        };
      }

      return assistantResult;
    });
  } catch (error) {
    const mappedError = mapAiAssistExecutionError(error);
    if (!mappedError) {
      throw error;
    }

    logger.warn(`[AI Assist] sendMessage failed: ${mappedError.warningDetail}`);
    res.status(mappedError.statusCode).send({
      success: false,
      message: mappedError.clientMessage
    });
    return;
  }

  res.status(200).send({
    success: true,
    data: result
  });
  queueAiTitleRefinement(titleRefinementPayload || {});
});

const sendFirstMessage = asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    throw new ErrorResponse(400, 'message is required');
  }
  const preferredLanguage = resolvePreferredLanguage(req);
  const assistContext = await resolveAssistContextPayload(req);
  const conversationSeed = {
    analysisMode: Boolean(assistContext?.analysisMode)
  };
  let titleRefinementPayload = null;

  if (isStreamingRequest(req)) {
    const postgres = getPostgresDb();
    initSse(res);

    try {
      // Create conversation first (fast write, outside AI transaction).
      const [conversation] = await createConversationRecord(
        postgres,
        req,
        conversationSeed
      );

      // Run AI outside any DB transaction — tool loops can take minutes and
      // would exceed any reasonable statement/transaction timeout.
      const assistantResult = await aiAssistOrchestrator.runAiAssist(postgres, {
        conversationId: conversation.id,
        message,
        assistContext,
        preferredLanguage,
        req,
        onProgress: async (event) => {
          writeSse(res, 'progress', event);
        },
        onToken: async (text) => {
          writeSse(res, 'token', { text });
        }
      });

      const conversationUpdates = buildConversationUpdateValues({
        conversation,
        message,
        assistContext,
        assistantResult
      });
      const updatedConversation = await updateOwnedActiveConversation(
        postgres,
        conversation.id,
        currentUserId(req),
        conversationUpdates
      );
      if (conversationUpdates.title) {
        titleRefinementPayload = {
          conversationId: conversation.id,
          ownerUserId: currentUserId(req),
          seedTitle: conversationUpdates.title,
          message,
          assistContext,
          assistantResult
        };
      }

      writeSse(res, 'final', {
        success: true,
        data: {
          conversation: updatedConversation,
          ...assistantResult
        }
      });
      writeSse(res, 'done', { ok: true });
      queueAiTitleRefinement(titleRefinementPayload || {});
    } catch (error) {
      logger.error('[AI Assist] streaming sendFirstMessage failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      const mappedError = mapAiAssistExecutionError(error);
      const detail =
        process.env.NODE_ENV !== 'production' && error instanceof Error
          ? error.message
          : undefined;
      if (mappedError) {
        logger.warn(
          `[AI Assist] streaming sendFirstMessage failed: ${mappedError.warningDetail}`
        );
        writeSse(res, 'error', {
          message: mappedError.clientMessage,
          detail
        });
      } else {
        writeSse(res, 'error', {
          message:
            error instanceof Error
              ? error.message
              : 'AI Assist streaming failed'
        });
      }
    } finally {
      res.end();
    }

    return;
  }

  const postgres = getPostgresDb();
  let result;
  try {
    result = await postgres.transaction(async (tx) => {
      const [conversation] = await createConversationRecord(
        tx,
        req,
        conversationSeed
      );

      const assistantResult = await aiAssistOrchestrator.runAiAssist(tx, {
        conversationId: conversation.id,
        message,
        assistContext,
        preferredLanguage,
        req
      });
      const conversationUpdates = buildConversationUpdateValues({
        conversation,
        message,
        assistContext,
        assistantResult
      });

      const updatedConversation = await updateOwnedActiveConversation(
        tx,
        conversation.id,
        currentUserId(req),
        conversationUpdates
      );
      if (conversationUpdates.title) {
        titleRefinementPayload = {
          conversationId: conversation.id,
          ownerUserId: currentUserId(req),
          seedTitle: conversationUpdates.title,
          message,
          assistContext,
          assistantResult
        };
      }

      return {
        conversation: updatedConversation,
        ...assistantResult
      };
    });
  } catch (error) {
    const mappedError = mapAiAssistExecutionError(error);
    if (!mappedError) {
      throw error;
    }

    logger.warn(
      `[AI Assist] sendFirstMessage failed: ${mappedError.warningDetail}`
    );
    res.status(mappedError.statusCode).send({
      success: false,
      message: mappedError.clientMessage
    });
    return;
  }

  res.status(201).send({
    success: true,
    data: result
  });
  queueAiTitleRefinement(titleRefinementPayload || {});
});

export = {
  archiveConversation,
  createConversation,
  getConversation,
  getLatestStudentAnalysis,
  getOverview,
  listConversations,
  listMyStudents,
  listRecentStudents,
  sendMessage,
  sendFirstMessage,
  updateConversation,
  searchStudents
};
