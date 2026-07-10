import { desc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { Role } from '@taiger-common/core';

import {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} from '../../drizzle/schema/schema';
import aiTools from './aiTools';
import llm from './llm';
import { REPLY_RESOURCE_LINKS } from './replyResources';
import type { Turn } from './llm/types';

// `llm` is a CommonJS (`export =`) module; under isolatedModules it must be
// imported as a default and destructured here rather than via a named import.
const { getLlmProvider, getConfiguredModel, getModelLabel } = llm;

// AI Assist orchestrator — a single provider-neutral agentic tool loop.
// One model turn per round; tools execute between rounds until the model
// produces a final answer (no tool calls) or MAX_TOOL_ROUNDS is reached.

const MAX_TOOL_ROUNDS = 12;
const RECENT_MESSAGE_WINDOW = 12;

interface MentionedStudent {
  id?: string;
  displayName?: string;
}

interface AssistContext {
  mentionedStudent?: MentionedStudent;
  analysisMode?: boolean;
  // When true, the orchestrator drafts a ready-to-send, student-facing reply
  // (reviewed by staff before sending) instead of an internal analysis.
  replyMode?: boolean;
}

interface ProgressEvent {
  type: string;
  [key: string]: unknown;
}

type ProgressEmitter = (event: ProgressEvent) => Promise<void> | void;
type TokenEmitter = (token: string) => Promise<void> | void;

interface LinkCandidate {
  entityType: string;
  entityId: string;
  displayName: string;
  school?: string;
}

interface OrchestratorToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

const baseInstructions =
  'You are TaiGer AI Assist, an experienced admissions counselor embedded in the TaiGer study-abroad platform used by internal staff (agents, editors, managers). ' +
  "Your goal: help staff understand each student's real situation and take the right actions to maximize admission success. " +
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
  '- Do not expose internal database ids. Respond with your final answer directly.\n\n' +
  'PLAIN LANGUAGE RULE — critical:\n' +
  'Never expose raw field names or code values from tool results. Translate everything to natural prose:\n' +
  '- hasFile: false → "no file uploaded yet"\n' +
  '- hasFile: true → "file uploaded"\n' +
  '- required: true → "required document"\n' +
  '- isFinalVersion: false → "not yet finalized"\n' +
  '- isFinalVersion: true → "finalized"\n' +
  '- pendingOwner: "team" → "waiting on your team to reply"\n' +
  '- pendingOwner: "student" → "waiting on the student"\n' +
  '- riskFlags: ["not_finalized"] → describe the risk in plain English, not the flag name\n' +
  '- messageCount: 0 → "no messages exchanged yet"\n' +
  '- status: "in_progress" → "application in progress"\n' +
  '- status: "final_enrolled" → "confirmed enrolment"\n' +
  '- admission: "O" → "admitted"\n' +
  '- admission: "X" → "rejected"\n' +
  'In general: if it looks like a database field name or a code value, rewrite it as something a non-technical staff member would say.';

const roleGuidance = (role: string) => {
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

const stripAssistControlTokens = (
  message = '',
  assistContext: AssistContext = {}
) => {
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

const buildLanguageInstruction = ({
  message,
  assistContext,
  preferredLanguage,
  analysisMode = false,
  replyMode = false
}: {
  message: string;
  assistContext: AssistContext;
  preferredLanguage?: string;
  analysisMode?: boolean;
  replyMode?: boolean;
}) => {
  // Reply drafts must be written in the STUDENT's language (not the staff
  // member's preference). REPLY_FORMAT_INSTRUCTION owns that rule, so emit no
  // competing language directive here.
  if (replyMode) {
    return '';
  }
  // For an auto-triggered deep-dive the "message" is a system-generated English
  // instruction, not the user's own writing — so the "match the message
  // language" heuristic would wrongly force the analysis into English. Honour
  // the staff member's preferred language instead.
  if (analysisMode) {
    return ` Respond in ${languageNameFromPreference(preferredLanguage)}.`;
  }
  const extraPromptText = stripAssistControlTokens(message, assistContext);
  if (extraPromptText) {
    return " Match the language and writing system of the user's message exactly; do not translate unless asked.";
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

Rules: Use only urgency levels IMMEDIATE, URGENT, NORMAL. Use only target roles AGENT, STUDENT, EDITOR, TEAM. If no blockers, write "- None identified." under BLOCKERS. Sections must appear in this exact order. CRITICAL: keep the section headers and all bracket/label tokens — HEALTH, BLOCKERS, RISKS, ACTIONS, ANALYSIS, ROOT CAUSE, SINCE, WAITING ON, [BLOCKER], [RISK:...], [ACTION:...] — in English exactly as shown, even when the rest of your answer is in another language (e.g. Chinese). Only the descriptive prose after each token should follow the user's language. Always include all five section headers, including **ANALYSIS:**.`;

const REPLY_FORMAT_INSTRUCTION = `

REPLY DRAFT MODE — you are drafting a message that the staff member will REVIEW and then SEND TO THE STUDENT. This is not an internal analysis; it is the actual reply text.

GATHER FIRST: before drafting, call get_student_overview AND get_communications, and call get_thread_messages for any document thread the student's question is about. Ground every statement in that tool data — the student's applications, program requirements, documents, profile, and chat history. Never invent deadlines, requirements, statuses, links, or facts.

WHAT TO WRITE:
- Address the student directly and answer their most recent message/question specifically and accurately.
- Tone: warm, professional, encouraging.
- Language: reply in the student's OWN language — match the language they write in. Use Traditional Chinese for Taiwanese students; never Simplified Chinese. If their language is unclear, use the staff member's preferred language.
- Point them to the clear next action, and include an official TaiGer guide/document link ONLY when it is genuinely on-topic.
- If required information is missing from the data, ask the student for it or tell them the team will follow up — do not guess.

OUTPUT RULES — strict:
- Output ONLY the message body to send to the student. No preamble ("Here is a draft"), no internal notes, no section headers/labels, no health/risk/analysis structure, no database ids.
- Light inline markdown (bold, links) is fine; do not use headings or tables.`;

const buildSystemPrompt = ({
  role,
  languageInstruction,
  analysisMode = false,
  replyMode = false
}: {
  role: string;
  languageInstruction: string;
  analysisMode?: boolean;
  replyMode?: boolean;
}) => {
  // Reply mode is student-facing; the analysis structured-format block must not
  // also be appended (the two output contracts conflict). Reply mode also gets
  // the curated TAIGER resource-link catalog.
  const formatInstruction = replyMode
    ? `${REPLY_FORMAT_INSTRUCTION}${REPLY_RESOURCE_LINKS}`
    : analysisMode
    ? ANALYSIS_FORMAT_INSTRUCTION
    : '';
  return `${baseInstructions}${roleGuidance(
    role
  )}${languageInstruction}${formatInstruction}`;
};

// ---- Persistence helpers ----------------------------------------------------

// `postgres` is a drizzle NodePgDatabase instance, but the module also accepts a
// lightweight mock (see the `!postgres.select` guard below). The drizzle query
// builder's chained generics cannot be expressed structurally without coupling
// to the full schema, so the param is left untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insertReturningOne = async (
  postgres: any,
  table: unknown,
  values: unknown
) => {
  const [row] = await postgres.insert(table).values(values).returning();
  return row;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createUserMessage = (
  postgres: any,
  { conversationId, content }: { conversationId: string; content: string }
) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'user',
    content
  });

const createAssistantMessage = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postgres: any,
  {
    conversationId,
    content,
    model,
    usage,
    linkHints
  }: {
    conversationId: string;
    content: string;
    model: string;
    usage: unknown;
    linkHints?: Record<string, unknown>;
  }
) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'assistant',
    content,
    model,
    usage,
    linkHints: linkHints || {}
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createToolCall = (postgres: any, values: Record<string, unknown>) =>
  insertReturningOne(postgres, aiAssistToolCalls, values);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadConversationContext = async (
  postgres: any,
  conversationId: string
) => {
  if (!postgres.select) {
    return {
      boundStudentId: undefined,
      boundStudentDisplayName: undefined,
      recentMessages: []
    };
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((message: any) => ({ role: message.role, content: message.content }))
  };
};

// ---- Link-hint candidate collection ----------------------------------------

const addStudentCandidate = (
  student:
    | { id?: string; displayName?: string; name?: string }
    | null
    | undefined,
  byKey: Map<string, LinkCandidate>
) => {
  const studentId = student?.id;
  const studentName = student?.displayName || student?.name;
  if (!studentId || !studentName) return;
  byKey.set(`student:${studentId}`, {
    entityType: 'student',
    entityId: studentId,
    displayName: studentName
  });
};

const collectCandidatesFromValue = (
  value: unknown,
  byKey: Map<string, LinkCandidate>
) => {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidatesFromValue(item, byKey));
    return;
  }

  const record = value as Record<string, any>;

  // Student shape: { id, name | displayName, email }
  if (
    typeof record.id === 'string' &&
    (typeof record.name === 'string' ||
      typeof record.displayName === 'string') &&
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

const safeEmitProgress = async (
  onProgress: ProgressEmitter | undefined,
  event: ProgressEvent
) => {
  if (typeof onProgress !== 'function') return;
  try {
    await onProgress({ timestamp: new Date().toISOString(), ...event });
  } catch {
    // Progress events are best-effort.
  }
};

const stringifyToolOutput = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
};

const executeToolCall = async (
  req: Request,
  toolCall: OrchestratorToolCall,
  { onProgress }: { onProgress?: ProgressEmitter } = {}
) => {
  const startedAt = Date.now();
  const toolName = toolCall.name;
  const args = toolCall.input || {};

  await safeEmitProgress(onProgress, {
    type: 'tool_start',
    toolName,
    arguments: args
  });

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
    const message =
      error instanceof Error ? error.message : 'Tool execution failed';
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

const buildTurns = ({
  recentMessages,
  message,
  hints
}: {
  recentMessages?: { role: string; content: string }[];
  message: string;
  hints: string[];
}) => {
  const turns: Turn[] = (recentMessages || []).map((entry) =>
    entry.role === 'assistant'
      ? ({ role: 'assistant', text: entry.content, toolCalls: [] } as Turn)
      : ({ role: 'user', content: entry.content } as Turn)
  );

  const composed = hints.length ? `${hints.join(' ')}\n\n${message}` : message;
  turns.push({ role: 'user', content: composed });
  return turns;
};

// ---- Main entry -------------------------------------------------------------

const runAiAssist = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postgres: any,
  {
    conversationId,
    message,
    req,
    assistContext = {},
    preferredLanguage,
    replyMode = false,
    onProgress,
    onToken
  }: {
    conversationId: string;
    message: string;
    req: Request;
    assistContext?: AssistContext;
    preferredLanguage?: string;
    replyMode?: boolean;
    onProgress?: ProgressEmitter;
    onToken?: TokenEmitter;
  }
) => {
  await safeEmitProgress(onProgress, { type: 'status', phase: 'start' });

  const conversationContext = await loadConversationContext(
    postgres,
    conversationId
  );

  const userMessage = await createUserMessage(postgres, {
    conversationId,
    content: message
  });

  const replyDraftMode = Boolean(replyMode || assistContext?.replyMode);
  const languageInstruction = buildLanguageInstruction({
    message,
    assistContext,
    preferredLanguage,
    analysisMode: Boolean(assistContext?.analysisMode),
    replyMode: replyDraftMode
  });
  const system = buildSystemPrompt({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    role: (req?.user as any)?.role,
    languageInstruction,
    analysisMode: Boolean(assistContext?.analysisMode),
    replyMode: replyDraftMode
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
      `The user is asking about student ${
        explicitStudent.displayName || ''
      } (id: ${explicitStudent.id}).`
    );
  } else if (boundStudent) {
    hints.push(
      `Active student in this conversation: ${
        boundStudent.displayName || ''
      } (id: ${boundStudent.id}).`
    );
  }

  const turns = buildTurns({
    recentMessages: conversationContext.recentMessages,
    message,
    hints
  });

  const provider = getLlmProvider();
  const model = getConfiguredModel();
  const trace: Record<string, unknown>[] = [];
  const candidatesByKey = new Map<string, LinkCandidate>();
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

    turns.push({
      role: 'assistant',
      text: turn.text,
      toolCalls: turn.toolCalls
    } as Turn);

    // eslint-disable-next-line no-await-in-loop
    const executed = await Promise.all(
      turn.toolCalls.map((toolCall) =>
        executeToolCall(req, toolCall, { onProgress })
      )
    );

    const results: {
      id: string;
      name: string;
      output: string;
      isError?: boolean;
    }[] = [];
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

    turns.push({ role: 'tool', results } as Turn);
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

  // Resolve the conversation's active student. Only bind when it is
  // unambiguous: an explicit mention, an existing binding, or exactly ONE
  // student surfaced this turn. Macro/multi-student turns (e.g. portfolio
  // overview, "compare A and B") surface many students — binding to the first
  // would make the "Current student" chip lie, so leave it null.
  const studentCandidates = candidates.filter(
    (candidate) => candidate.entityType === 'student'
  );
  const activeStudent =
    explicitStudent ||
    boundStudent ||
    (studentCandidates.length === 1
      ? {
          id: studentCandidates[0].entityId,
          displayName: studentCandidates[0].displayName
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
