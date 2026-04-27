const { asc, desc, eq, and, isNotNull } = require('drizzle-orm');
const { ErrorResponse } = require('../common/errors');
const { getPostgresDb } = require('../database');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} = require('../drizzle/schema/schema');
const aiAssistOrchestrator = require('../services/ai-assist/orchestrator');
const {
  normalizeStudentPickerRow,
  requireAccessibleStudent,
  searchAccessibleStudents
} = require('../services/ai-assist/tools');
const {
  getAccessibleStudentFilter
} = require('../services/ai-assist/studentAccess');
const { withPostgresRetry } = require('../services/ai-assist/postgresRetry');
const logger = require('../services/logger');

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
  'review_open_tasks'
]);

const lower = (value) => String(value || '').toLowerCase();

const extractOpenAiErrorMetadata = (error) => ({
  status:
    Number(error?.status) ||
    Number(error?.statusCode) ||
    Number(error?.error?.status) ||
    null,
  code: lower(error?.code || error?.type || error?.error?.code || error?.error?.type),
  message:
    error?.error?.message ||
    error?.message ||
    ''
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
      warningDetail: metadata.message || metadata.code || 'OpenAI quota exceeded'
    };
  }

  return {
    statusCode: 502,
    clientMessage: 'AI Assist is temporarily unavailable. Please try again.',
    warningDetail: metadata.message || metadata.code || 'OpenAI request failed'
  };
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
        : raw.unknownSkillText || null
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

const insertConversationRecord = async (db, req, extraValues = {}) => {
  return db
    .insert(aiAssistConversations)
    .values({
      ownerUserId: currentUserId(req),
      ownerRole: req.user.role,
      title: req.body?.title || DEFAULT_TITLE,
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
  const students = await req.db
    .model('Student')
    .find({
      ...filter,
      _id: { $in: recentStudentIds }
    })
    .select(STUDENT_PICKER_FIELDS)
    .limit(recentStudentIds.length)
    .lean();

  const studentsById = new Map(
    students.map((student) => [student._id?.toString?.() || student.id, student])
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

const listMyStudents = asyncHandler(async (req, res) => {
  const filter = await getAccessibleStudentFilter(req);
  const students = await req.db
    .model('Student')
    .find(filter)
    .select(STUDENT_PICKER_FIELDS)
    .limit(25)
    .lean();

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

  if (isStreamingRequest(req)) {
    const postgres = getPostgresDb();
    initSse(res);

    try {
      const result = await postgres.transaction(async (tx) => {
        await requireActiveConversationOwner(tx, conversationId, currentUserId(req));

        const assistantResult = await aiAssistOrchestrator.runAiAssist(tx, {
          conversationId,
          message,
          assistContext: await resolveAssistContextPayload(req),
          preferredLanguage: resolvePreferredLanguage(req),
          req,
          onProgress: async (event) => {
            writeSse(res, 'progress', event);
          },
          onToken: async (text) => {
            writeSse(res, 'token', { text });
          }
        });

        await updateOwnedActiveConversation(
          tx,
          conversationId,
          currentUserId(req),
          {
            updatedAt: new Date()
          }
        );

        return assistantResult;
      });

      writeSse(res, 'final', {
        success: true,
        data: result
      });
      writeSse(res, 'done', { ok: true });
    } catch (error) {
      const mappedError = mapAiAssistExecutionError(error);
      if (mappedError) {
        logger.warn(
          `[AI Assist] streaming sendMessage failed: ${mappedError.warningDetail}`
        );
        writeSse(res, 'error', {
          message: mappedError.clientMessage
        });
      } else {
        writeSse(res, 'error', {
          message:
            error instanceof Error ? error.message : 'AI Assist streaming failed'
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
      await requireActiveConversationOwner(tx, conversationId, currentUserId(req));

      const assistantResult = await aiAssistOrchestrator.runAiAssist(tx, {
        conversationId,
        message,
        assistContext: await resolveAssistContextPayload(req),
        preferredLanguage: resolvePreferredLanguage(req),
        req
      });

      await updateOwnedActiveConversation(
        tx,
        conversationId,
        currentUserId(req),
        {
          updatedAt: new Date()
        }
      );

      return assistantResult;
    });
  } catch (error) {
    const mappedError = mapAiAssistExecutionError(error);
    if (!mappedError) {
      throw error;
    }

    logger.warn(
      `[AI Assist] sendMessage failed: ${mappedError.warningDetail}`
    );
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
});

const sendFirstMessage = asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    throw new ErrorResponse(400, 'message is required');
  }

  if (isStreamingRequest(req)) {
    const postgres = getPostgresDb();
    initSse(res);

    try {
      const result = await postgres.transaction(async (tx) => {
        const [conversation] = await createConversationRecord(tx, req);

        const assistantResult = await aiAssistOrchestrator.runAiAssist(tx, {
          conversationId: conversation.id,
          message,
          assistContext: await resolveAssistContextPayload(req),
          preferredLanguage: resolvePreferredLanguage(req),
          req,
          onProgress: async (event) => {
            writeSse(res, 'progress', event);
          },
          onToken: async (text) => {
            writeSse(res, 'token', { text });
          }
        });

        await updateOwnedActiveConversation(
          tx,
          conversation.id,
          currentUserId(req),
          {
            updatedAt: new Date()
          }
        );

        return {
          conversation,
          ...assistantResult
        };
      });

      writeSse(res, 'final', {
        success: true,
        data: result
      });
      writeSse(res, 'done', { ok: true });
    } catch (error) {
      const mappedError = mapAiAssistExecutionError(error);
      if (mappedError) {
        logger.warn(
          `[AI Assist] streaming sendFirstMessage failed: ${mappedError.warningDetail}`
        );
        writeSse(res, 'error', {
          message: mappedError.clientMessage
        });
      } else {
        writeSse(res, 'error', {
          message:
            error instanceof Error ? error.message : 'AI Assist streaming failed'
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
      const [conversation] = await createConversationRecord(tx, req);

      const assistantResult = await aiAssistOrchestrator.runAiAssist(tx, {
        conversationId: conversation.id,
        message,
        assistContext: await resolveAssistContextPayload(req),
        preferredLanguage: resolvePreferredLanguage(req),
        req
      });

      await updateOwnedActiveConversation(
        tx,
        conversation.id,
        currentUserId(req),
        {
          updatedAt: new Date()
        }
      );

      return {
        conversation,
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
});

module.exports = {
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  listMyStudents,
  listRecentStudents,
  sendMessage,
  sendFirstMessage,
  updateConversation,
  searchStudents
};
