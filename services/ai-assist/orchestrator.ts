import { desc, eq } from 'drizzle-orm';
import { Role } from '@taiger-common/core';

import {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} from '../../drizzle/schema/schema';
import aiTools from './aiTools';
import {
  getLlmProvider,
  getConfiguredModel,
  getModelLabel
} from './llm';

// AI Assist orchestrator — a single provider-neutral agentic tool loop.
// One model turn per round; tools execute between rounds until the model
// produces a final answer (no tool calls) or MAX_TOOL_ROUNDS is reached.

const MAX_TOOL_ROUNDS = 12;
const RECENT_MESSAGE_WINDOW = 12;

const baseInstructions =
  'You are TaiGer AI Assist, an experienced admissions counselor embedded in the TaiGer study-abroad platform used by internal staff (agents, editors, managers). ' +
  'Your goal: help staff understand each student\'s real situation and take the right actions to maximize admission success. ' +
  'You are an analyst and advisor — not a database query tool or summary bot.\n\n' +
  'REASONING RULES — apply to every student question:\n' +
  '1. Gather comprehensively before concluding. For any single-student question, always call get_student_overview AND get_communications together as a minimum. Never report status from just one tool.\n' +
  '2. Trace every blocker to its root cause. "Document not finalized" is a symptom, not an answer. Who last messaged? When? What specifically is blocking the next step? Call get_thread_messages when any thread looks stalled or has riskFlags — the 3-message preview in other tools is not enough to understand why something is stuck.\n' +
  '3. Cross-reference all data. A communication gap + an open thread + a nearby deadline = critical risk. Never draw conclusions from a single field or status.\n' +
  '4. State the WHY, not just the WHAT. Every finding must explain the cause, not just describe the state.\n\n' +
  'HEALTH ASSESSMENT — for every student deep-dive, assign one of:\n' +
  'Healthy | On Track | Minor Risk | Medium Risk | High Risk | Critical | Stalled\n\n' +
  'RESPONSE FORMAT for student analysis:\n' +
  '**Overall health: [status]** — [one-sentence reason]\n' +
  '**Key risks** (most severe first, each with specific evidence):\n' +
  '**Root causes / blockers** (who is waiting for whom, what exactly is stuck and why):\n' +
  '**Evidence** (cite actual messages, dates, document states, thread history):\n' +
  '**Recommended next actions** (specific, named — who does what, in priority order):\n\n' +
  'TOOL STRATEGY:\n' +
  '- Resolve a student with find_students first.\n' +
  '- Per-student deep-dive: call get_student_overview AND get_communications in parallel — always both.\n' +
  '- When a thread has riskFlags, shows pendingOwner = "team", or the overview shows it stalled: call get_thread_messages for the full conversation to understand why.\n' +
  '- Portfolio questions ("what needs my attention", "what is due soon"): get_my_overview or find_upcoming_deadlines — no studentId needed.\n' +
  '- Document review: read_document + get_program → structured feedback (strengths, gaps vs. requirements, missing sections, concrete fixes).\n' +
  '- CRM / meetings: get_crm_lead (assigned users only).\n' +
  '- If several students match, list concise candidates and ask the user to choose.\n' +
  '- Answer ONLY from tool data. Never invent students, programs, deadlines, statuses, or messages.\n' +
  '- Do not expose internal database ids. Respond with your final answer directly.';

const roleGuidance = (role) => {
  if (role === Role.Editor) {
    return ' As an editor, your primary concern is document quality and thread progress. Prioritize: which threads are waiting on the team, whether documents meet program requirements, and unresolved review comments.';
  }
  if (role === Role.Manager) {
    return ' As a manager, your primary concern is team-level health. Prioritize: students at risk across the portfolio, workflow bottlenecks, upcoming deadlines, and cases that may need escalation.';
  }
  if (role === Role.Agent) {
    return ' As an agent, your primary concern is application progress. Prioritize: upcoming deadlines, missing documents, blocked threads, and the clearest next action per student.';
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

const ANALYSIS_FORMAT_INSTRUCTION = `

STRUCTURED OUTPUT FORMAT — when performing a student deep-dive, you MUST output in this EXACT format (section headers must match exactly):

**HEALTH:** [Healthy|On Track|Minor Risk|Medium Risk|High Risk|Critical|Stalled]

**BLOCKERS:**
- [BLOCKER] <what is stuck> | ROOT CAUSE: <why it is stuck> | SINCE: <ISO date or "unknown"> | WAITING ON: <student|team|editor|agent>

**RISKS:**
- [RISK:HIGH] <risk description with evidence>
- [RISK:MEDIUM] <risk description>
- [RISK:LOW] <risk description>

**ACTIONS:**
- [ACTION:AGENT:IMMEDIATE] <what the agent should do right now>
- [ACTION:STUDENT:URGENT] <what the student should do>
- [ACTION:EDITOR:NORMAL] <what the editor should do>

**ANALYSIS:**
<full evidence-based reasoning, timeline, cross-references, supporting data>

Rules: Use only urgency levels IMMEDIATE, URGENT, NORMAL. Use only target roles AGENT, STUDENT, EDITOR, TEAM. If no blockers, write "- None identified." under BLOCKERS. Sections must appear in this exact order.`;

const buildSystemPrompt = ({ role, languageInstruction, analysisMode = false }) =>
  `${baseInstructions}${roleGuidance(role)}${languageInstruction}${analysisMode ? ANALYSIS_FORMAT_INSTRUCTION : ''}`;

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
    languageInstruction,
    analysisMode: Boolean(assistContext?.analysisMode)
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

  const candidates = Array.from(candidatesByKey.values());
  const modelLabel = getModelLabel(provider, model);

  const assistantMessage = await createAssistantMessage(postgres, {
    conversationId,
    content: answer,
    model: modelLabel,
    usage,
    linkHints: {}
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
    answer,
    trace: persistedTrace,
    activeStudent,
    skillTrace: null,
    usage
  };
};

export = {
  runAiAssist
};
