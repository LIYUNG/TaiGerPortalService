import { desc, eq } from 'drizzle-orm';
import { Role } from '@taiger-common/core';

import {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} from '../../drizzle/schema/schema';
import aiTools from './aiTools';
import { extractAnswerReferences } from './answerComposer';
import {
  getLlmProvider,
  getConfiguredModel,
  getModelLabel
} from './llm';

// AI Assist orchestrator — a single provider-neutral agentic tool loop.
// One model turn per round; tools execute between rounds until the model
// produces a final answer (no tool calls) or MAX_TOOL_ROUNDS is reached.

const MAX_TOOL_ROUNDS = 8;
const RECENT_MESSAGE_WINDOW = 12;

const baseInstructions =
  'You are TaiGer AI Assist, an assistant for the TaiGer study-abroad application platform used by internal staff (agents, editors, managers). ' +
  'Answer ONLY from data returned by tools. Never invent students, applications, programs, ids, deadlines, statuses, or document content. ' +
  'Resolve a student with find_students before calling student-specific tools. ' +
  'For one student use get_student_overview (profile, applications, documents, threads), get_communications, or get_document_threads. ' +
  'For portfolio-wide "what needs my attention" or "what is due soon" questions use get_my_overview or find_upcoming_deadlines (these span ALL the user\'s students and need no studentId). ' +
  'To review a CV, essay, motivation letter, or recommendation letter, call read_document to read its text and get_program for the program\'s requirements, then give specific, structured feedback (strengths, gaps vs. requirements, missing sections, concrete fixes). ' +
  'If several students match, ask the user to choose and list concise candidates. ' +
  'Be concise and specific, say which student/application the information is about, and do not expose internal database ids unless needed to disambiguate. ' +
  'Respond with your final answer directly, without narrating internal reasoning.';

const roleGuidance = (role) => {
  if (role === Role.Editor) {
    return ' As an editor, prioritize the document-thread queue (threads waiting on the team) and reviewing document quality against each program\'s requirements.';
  }
  if (role === Role.Manager) {
    return ' As a manager, prioritize team-level rollups: students at risk, upcoming deadlines across the team, and workflow bottlenecks.';
  }
  if (role === Role.Agent) {
    return ' As an agent, prioritize application progress, upcoming deadlines, missing documents, and the clearest next actions per student.';
  }
  return '';
};

const languageNameFromPreference = (preferredLanguage = 'en') => {
  const normalized = String(preferredLanguage || 'en').toLowerCase();
  if (normalized.startsWith('zh-tw')) return 'Traditional Chinese';
  if (normalized.startsWith('zh-cn')) return 'Simplified Chinese';
  if (normalized.startsWith('zh')) return 'Chinese';
  return 'English';
};

const escapeRegExp = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripAssistControlTokens = (message = '', assistContext = {}) => {
  let promptText = String(message || '');
  const displayName = assistContext?.mentionedStudent?.displayName;
  if (displayName) {
    promptText = promptText.replace(
      new RegExp(`@${escapeRegExp(displayName)}`, 'gi'),
      ' '
    );
  }
  return promptText.replace(/\s+/g, ' ').trim();
};

const buildLanguageInstruction = ({ message, assistContext, preferredLanguage }) => {
  const extraPromptText = stripAssistControlTokens(message, assistContext);
  if (extraPromptText) {
    return ' Match the language and writing system of the user\'s message exactly; do not translate unless asked.';
  }
  return ` Respond in ${languageNameFromPreference(preferredLanguage)}.`;
};

const buildSystemPrompt = ({ role, languageInstruction }) =>
  `${baseInstructions}${roleGuidance(role)}${languageInstruction}`;

// ---- Persistence helpers ----------------------------------------------------

const insertReturningOne = async (postgres, table, values) => {
  const [row] = await postgres.insert(table).values(values).returning();
  return row;
};

const createUserMessage = (postgres, { conversationId, content }) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'user',
    content
  });

const createAssistantMessage = (
  postgres,
  { conversationId, content, model, usage, linkHints }
) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'assistant',
    content,
    model,
    usage,
    linkHints: linkHints || {}
  });

const createToolCall = (postgres, values) =>
  insertReturningOne(postgres, aiAssistToolCalls, values);

const loadConversationContext = async (postgres, conversationId) => {
  if (!postgres.select) {
    return { boundStudentId: undefined, boundStudentDisplayName: undefined, recentMessages: [] };
  }

  const [conversation, messages] = await Promise.all([
    postgres
      .select()
      .from(aiAssistConversations)
      .where(eq(aiAssistConversations.id, conversationId))
      .limit(1),
    postgres
      .select()
      .from(aiAssistMessages)
      .where(eq(aiAssistMessages.conversationId, conversationId))
      .orderBy(desc(aiAssistMessages.createdAt))
      .limit(RECENT_MESSAGE_WINDOW)
  ]);

  const conversationRow = conversation?.[0] || null;

  return {
    boundStudentId:
      conversationRow?.studentId?.toString?.() ||
      conversationRow?.studentId ||
      undefined,
    boundStudentDisplayName: conversationRow?.studentDisplayName || undefined,
    recentMessages: messages
      .slice()
      .reverse()
      .map((message) => ({ role: message.role, content: message.content }))
  };
};

// ---- Link-hint candidate collection ----------------------------------------

const addStudentCandidate = (student, byKey) => {
  const studentId = student?.id;
  const studentName = student?.displayName || student?.name;
  if (!studentId || !studentName) return;
  byKey.set(`student:${studentId}`, {
    entityType: 'student',
    entityId: studentId,
    displayName: studentName
  });
};

const collectCandidatesFromValue = (value, byKey) => {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidatesFromValue(item, byKey));
    return;
  }

  const record = value;

  // Student shape: { id, name | displayName, email }
  if (
    typeof record.id === 'string' &&
    (typeof record.name === 'string' || typeof record.displayName === 'string') &&
    (record.email !== undefined || record.role !== undefined)
  ) {
    addStudentCandidate(record, byKey);
  }

  // Program shape: { program: { id, name, school } } or { id, school, name }
  const program = record.program || null;
  if (program?.id && program?.name) {
    byKey.set(`program:${program.id}`, {
      entityType: 'program',
      entityId: program.id,
      displayName: program.name,
      school: program.school
    });
  }

  Object.values(record).forEach((nested) =>
    collectCandidatesFromValue(nested, byKey)
  );
};

// ---- Tool execution ---------------------------------------------------------

const safeEmitProgress = async (onProgress, event) => {
  if (typeof onProgress !== 'function') return;
  try {
    await onProgress({ timestamp: new Date().toISOString(), ...event });
  } catch {
    // Progress events are best-effort.
  }
};

const stringifyToolOutput = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
};

const executeToolCall = async (req, toolCall, { onProgress } = {}) => {
  const startedAt = Date.now();
  const toolName = toolCall.name;
  const args = toolCall.input || {};

  await safeEmitProgress(onProgress, { type: 'tool_start', toolName, arguments: args });

  try {
    if (!aiTools.hasTool(toolName)) {
      throw new Error(`Unknown AI Assist tool: ${toolName}`);
    }
    const result = await aiTools.runTool(req, toolName, args);
    const durationMs = Date.now() - startedAt;
    await safeEmitProgress(onProgress, {
      type: 'tool_done',
      toolName,
      arguments: args,
      status: 'success',
      durationMs
    });

    return {
      trace: {
        toolName,
        arguments: args,
        result,
        status: 'success',
        durationMs,
        permissionOutcome: { inheritedUserPermission: true }
      },
      output: stringifyToolOutput(result)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed';
    const durationMs = Date.now() - startedAt;
    await safeEmitProgress(onProgress, {
      type: 'tool_done',
      toolName,
      arguments: args,
      status: 'failed',
      durationMs,
      errorMessage: message
    });

    return {
      trace: {
        toolName,
        arguments: args,
        result: { error: message },
        status: 'failed',
        durationMs,
        errorMessage: message,
        permissionOutcome: { inheritedUserPermission: true }
      },
      output: JSON.stringify({ error: message }),
      isError: true
    };
  }
};

// ---- Turn construction ------------------------------------------------------

const buildTurns = ({ recentMessages, message, hints }) => {
  const turns = (recentMessages || []).map((entry) =>
    entry.role === 'assistant'
      ? { role: 'assistant', text: entry.content, toolCalls: [] }
      : { role: 'user', content: entry.content }
  );

  const composed = hints.length ? `${hints.join(' ')}\n\n${message}` : message;
  turns.push({ role: 'user', content: composed });
  return turns;
};

// ---- Main entry -------------------------------------------------------------

const runAiAssist = async (
  postgres,
  { conversationId, message, req, assistContext = {}, preferredLanguage, onProgress, onToken }
) => {
  await safeEmitProgress(onProgress, { type: 'status', phase: 'start' });

  const conversationContext = await loadConversationContext(postgres, conversationId);

  const userMessage = await createUserMessage(postgres, {
    conversationId,
    content: message
  });

  const languageInstruction = buildLanguageInstruction({
    message,
    assistContext,
    preferredLanguage
  });
  const system = buildSystemPrompt({
    role: req?.user?.role,
    languageInstruction
  });

  // Context hints injected into the current user turn.
  const explicitStudent = assistContext?.mentionedStudent?.id
    ? {
        id: assistContext.mentionedStudent.id,
        displayName: assistContext.mentionedStudent.displayName || null
      }
    : null;
  const boundStudent =
    !explicitStudent && conversationContext.boundStudentId
      ? {
          id: conversationContext.boundStudentId,
          displayName: conversationContext.boundStudentDisplayName || null
        }
      : null;
  const hints = [];
  if (explicitStudent) {
    hints.push(
      `The user is asking about student ${explicitStudent.displayName || ''} (id: ${explicitStudent.id}).`
    );
  } else if (boundStudent) {
    hints.push(
      `Active student in this conversation: ${boundStudent.displayName || ''} (id: ${boundStudent.id}).`
    );
  }

  const turns = buildTurns({
    recentMessages: conversationContext.recentMessages,
    message,
    hints
  });

  const provider = getLlmProvider();
  const model = getConfiguredModel();
  const trace = [];
  const candidatesByKey = new Map();
  let answer = '';
  let usage;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    await safeEmitProgress(onProgress, {
      type: 'thinking',
      phase: 'model',
      round: round + 1
    });

    // eslint-disable-next-line no-await-in-loop
    const turn = await provider.stream(
      { system, turns, tools: aiTools.definitions, model },
      { onToken }
    );
    usage = turn.usage || usage;
    answer = turn.text || answer;

    if (!turn.toolCalls || !turn.toolCalls.length) {
      break;
    }

    turns.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });

    // eslint-disable-next-line no-await-in-loop
    const executed = await Promise.all(
      turn.toolCalls.map((toolCall) =>
        executeToolCall(req, toolCall, { onProgress })
      )
    );

    const results = [];
    executed.forEach((execution, index) => {
      const toolCall = turn.toolCalls[index];
      trace.push(execution.trace);
      collectCandidatesFromValue(execution.trace.result, candidatesByKey);
      results.push({
        id: toolCall.id,
        name: toolCall.name,
        output: execution.output,
        isError: execution.isError
      });
    });

    turns.push({ role: 'tool', results });
  }

  if (!answer) {
    answer =
      'I could not produce an answer from the available TaiGer data. Please rephrase or narrow the request.';
  }

  await safeEmitProgress(onProgress, {
    type: 'status',
    phase: 'annotation',
    status: 'annotating_references'
  });

  const candidates = Array.from(candidatesByKey.values());
  const answerReferences = await extractAnswerReferences({ answer, candidates });
  const normalizedAnswer = answerReferences?.answer || answer;
  const linkHints =
    answerReferences?.linkHints && typeof answerReferences.linkHints === 'object'
      ? answerReferences.linkHints
      : {};

  const modelLabel = getModelLabel(provider, model);

  const assistantMessage = await createAssistantMessage(postgres, {
    conversationId,
    content: normalizedAnswer,
    model: modelLabel,
    usage,
    linkHints
  });

  const persistedTrace = await Promise.all(
    trace.map((toolCall) =>
      createToolCall(postgres, {
        conversationId,
        assistantMessageId: assistantMessage.id,
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        result: toolCall.result,
        status: toolCall.status,
        durationMs: toolCall.durationMs,
        permissionOutcome: toolCall.permissionOutcome,
        errorMessage: toolCall.errorMessage
      })
    )
  );

  // Resolve the conversation's active student: explicit mention, conversation
  // binding, or the first student surfaced by the tools this turn.
  const firstStudentCandidate = candidates.find(
    (candidate) => candidate.entityType === 'student'
  );
  const activeStudent =
    explicitStudent ||
    boundStudent ||
    (firstStudentCandidate
      ? {
          id: firstStudentCandidate.entityId,
          displayName: firstStudentCandidate.displayName
        }
      : null);

  await safeEmitProgress(onProgress, {
    type: 'status',
    phase: 'completed',
    traceCount: persistedTrace.length
  });

  return {
    userMessage,
    assistantMessage,
    answer: normalizedAnswer,
    trace: persistedTrace,
    activeStudent,
    skillTrace: null,
    usage
  };
};

export = {
  runAiAssist
};
