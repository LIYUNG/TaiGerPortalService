const { desc, eq } = require('drizzle-orm');
const { OpenAiModel, openAIClient } = require('../openai');
const {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} = require('../../drizzle/schema/schema');
const {
  aiAssistToolDefinitions,
  aiAssistToolDefinitionsByName
} = require('./toolDefinitions');
const tools = require('./tools');
const { classifyIntent } = require('./intentRouter');
const { resolveStudent } = require('./entityResolver');
const { composeAnswer, generateAnswerFromInput } = require('./answerComposer');

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';
const MAX_TOOL_ROUNDS = 6;
const DEFAULT_SKILL_MESSAGE_LIMIT = 10;

const instructions =
  'You are TaiGer AI Assist. Answer only from TaiGer Portal data returned by tools. Match the user\'s current language and writing system exactly. Do not switch scripts or translate the user\'s chosen language unless asked. Use tools whenever the user asks about TaiGer students, applications, communications, documents, tickets, or programs. Start by searching for a student when you need a studentId. Use conversationContext to resolve follow-up references such as numbers, names, emails, "he", "she", "他", "她", "這位", or "that student". If multiple students match, ask the user to choose one and list concise candidates. Do not invent tool names, IDs, facts, or future tool calls.';

const languagePolicyInstructions =
  'Follow responseLanguageInstruction exactly. If it says to use the extra user prompt language, match that language and writing system exactly.';

const INTENT_TOOL_PLAN = Object.freeze({
  student_lookup: ['get_student_context'],
  student_applications: ['get_application_context'],
  student_communications: ['get_recent_communication_context'],
  admissions_overview: ['get_application_context'],
  support_tickets: ['get_support_ticket_context'],
  student_documents: ['get_document_context']
});

const buildStudentToolStep = (toolName, extraArgs = {}) => (student) => ({
  toolName,
  args: {
    studentId: student.id,
    ...extraArgs
  }
});

const SKILL_PLANS = Object.freeze({
  summarize_student: {
    steps: [
      buildStudentToolStep('get_student_summary'),
      buildStudentToolStep('get_student_applications')
    ],
    synthesisInstruction:
      'Summarize the student using only the provided data. Cover the student profile, active applications, and the most important next-step context.'
  },
  identify_risk: {
    steps: [
      buildStudentToolStep('get_student_applications'),
      buildStudentToolStep('get_latest_communications', {
        limit: DEFAULT_SKILL_MESSAGE_LIMIT
      })
    ],
    synthesisInstruction:
      'Identify concrete risks, blockers, delays, or missing items supported by the provided data. Prioritize the most urgent issues first.'
  },
  review_messages: {
    steps: [
      buildStudentToolStep('get_latest_communications', {
        limit: DEFAULT_SKILL_MESSAGE_LIMIT
      })
    ],
    synthesisInstruction:
      'Review the recent communications and summarize the key themes, requests, decisions, and pending follow-ups using only the provided data.'
  },
  review_open_tasks: {
    steps: [
      buildStudentToolStep('get_student_applications'),
      buildStudentToolStep('get_profile_documents'),
      buildStudentToolStep('get_support_tickets', {
        limit: DEFAULT_SKILL_MESSAGE_LIMIT
      })
    ],
    synthesisInstruction:
      'Review open tasks using only the provided data. Highlight pending application work, incomplete documents, unresolved support issues, and the clearest next actions.'
  }
});

const insertReturningOne = async (postgres, table, values) => {
  const [row] = await postgres.insert(table).values(values).returning();
  return row;
};

const createUserMessage = (postgres, { conversationId, content, skillTrace }) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'user',
    content,
    skillTrace
  });

const createAssistantMessage = (
  postgres,
  { conversationId, content, response, skillTrace }
) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'assistant',
    content,
    model: DEFAULT_MODEL,
    responseId: response?.id,
    usage: response?.usage,
    skillTrace
  });

const buildSkillTrace = (assistContext = {}) => {
  if (
    !assistContext.requestedSkill &&
    !assistContext.resolvedSkill &&
    !assistContext.unknownSkillText &&
    !assistContext.fallbackReason
  ) {
    return undefined;
  }

  return {
    requestedSkill: assistContext.requestedSkill || null,
    resolvedSkill: assistContext.resolvedSkill || null,
    mode: assistContext.mode || 'general',
    student: assistContext.student || null,
    status: assistContext.status || 'fallback',
    steps: assistContext.steps || [],
    fallbackReason: assistContext.fallbackReason || null
  };
};

const buildUserMessageSkillTrace = ({
  assistContext = {},
  resolvedAssistContext = {}
}) => {
  const mentionedStudent = assistContext.mentionedStudent?.id
    ? {
        id: assistContext.mentionedStudent.id,
        displayName: assistContext.mentionedStudent.displayName || null
      }
    : null;

  if (
    !mentionedStudent &&
    !assistContext.requestedSkill &&
    !assistContext.unknownSkillText
  ) {
    return undefined;
  }

  return {
    requestedSkill: assistContext.requestedSkill || null,
    resolvedSkill: resolvedAssistContext.resolvedSkill || null,
    mode: 'composer',
    student: mentionedStudent,
    status: 'captured',
    steps: [],
    fallbackReason: resolvedAssistContext.fallbackReason || null
  };
};

const createToolCall = (postgres, values) =>
  insertReturningOne(postgres, aiAssistToolCalls, values);

const escapeRegExp = (value = '') =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripAssistControlTokens = (message = '', assistContext = {}) => {
  let promptText = message;
  const displayName = assistContext.mentionedStudent?.displayName;

  if (displayName) {
    promptText = promptText.replace(
      new RegExp(`@${escapeRegExp(displayName)}`, 'gi'),
      ' '
    );
  }

  return promptText.replace(/#[a-z_]+/gi, ' ').replace(/\s+/g, ' ').trim();
};

const languageNameFromPreference = (preferredLanguage = 'en') => {
  const normalized = String(preferredLanguage || 'en').toLowerCase();

  if (normalized.startsWith('zh-tw')) {
    return 'Traditional Chinese';
  }

  if (normalized.startsWith('zh-cn')) {
    return 'Simplified Chinese';
  }

  if (normalized.startsWith('zh')) {
    return 'Chinese';
  }

  return 'English';
};

const buildResponseLanguageInstruction = ({
  message,
  assistContext,
  preferredLanguage
}) => {
  const extraPromptText = stripAssistControlTokens(message, assistContext);

  if (extraPromptText) {
    return 'Use the language of the extra user prompt.';
  }

  return `Respond in ${languageNameFromPreference(preferredLanguage)}.`;
};

const parseArguments = (rawArguments) => {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === 'object') {
    return rawArguments;
  }

  return JSON.parse(rawArguments);
};

const stringifyToolOutput = (value) => JSON.stringify(value, null, 2);

const loadConversationContext = async (postgres, conversationId) => {
  if (!postgres.select) {
    return {
      boundStudentId: undefined,
      boundStudentDisplayName: undefined,
      recentMessages: [],
      recentToolCalls: []
    };
  }

  const [conversation, messages, toolCalls] = await Promise.all([
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
      .limit(12),
    postgres
      .select()
      .from(aiAssistToolCalls)
      .where(eq(aiAssistToolCalls.conversationId, conversationId))
      .orderBy(desc(aiAssistToolCalls.createdAt))
      .limit(12)
  ]);

  return {
    boundStudentId: undefined,
    boundStudentDisplayName: undefined,
    recentMessages: messages
      .slice()
      .reverse()
      .map((message) => ({
        role: message.role,
        content: message.content
      })),
    recentToolCalls: toolCalls
      .slice()
      .reverse()
      .map((toolCall) => ({
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        result: toolCall.result,
        status: toolCall.status
      }))
  };
};

const buildInitialInput = ({
  message,
  conversationContext,
  responseLanguageInstruction
}) => [
  {
    role: 'user',
    content: JSON.stringify(
      {
        currentUserMessage: message,
        responseLanguageInstruction,
        conversationContext
      },
      null,
      2
    )
  }
];

const autoDetectSkill = (message = '') => {
  const normalizedMessage = message.toLowerCase();
  const explicitSkillMatch = normalizedMessage.match(/#([a-z_]+)/);

  if (explicitSkillMatch?.[1] && SKILL_PLANS[explicitSkillMatch[1]]) {
    return explicitSkillMatch[1];
  }

  return null;
};

const resolveAssistContext = ({
  assistContext = {},
  conversationContext,
  message
}) => {
  const requestedSkill = assistContext.requestedSkill || null;
  const unknownSkillText = assistContext.unknownSkillText || null;
  const student = assistContext.mentionedStudent?.id
    ? {
        id: assistContext.mentionedStudent.id,
        displayName: assistContext.mentionedStudent.displayName || null
      }
    : null;
  const candidateSkill =
    requestedSkill || (!unknownSkillText ? autoDetectSkill(message) : null);
  let resolvedSkill = candidateSkill;
  let fallbackReason = null;

  if (unknownSkillText) {
    fallbackReason = `Unsupported skill request: ${unknownSkillText}`;
    resolvedSkill = null;
  } else if (candidateSkill && !SKILL_PLANS[candidateSkill]) {
    fallbackReason = `Unsupported skill request: ${candidateSkill}`;
    resolvedSkill = null;
  } else if (candidateSkill && !student?.id) {
    fallbackReason = 'Skill mode requires a message-level @student.';
    resolvedSkill = null;
  }

  return {
    requestedSkill,
    resolvedSkill,
    unknownSkillText,
    student,
    fallbackReason
  };
};

const getFunctionCalls = (response) =>
  (response?.output || []).filter((item) => item.type === 'function_call');

const getResponseText = (response) => {
  if (response?.output_text) {
    return response.output_text;
  }

  const message = (response?.output || []).find((item) => item.type === 'message');
  const textParts = message?.content || [];
  return textParts
    .map((part) => part.text || part.content || '')
    .filter(Boolean)
    .join('\n');
};

const executeFunctionCall = async (req, functionCall, { onProgress } = {}) => {
  const startedAt = Date.now();
  const toolName = functionCall.name;
  const args = parseArguments(functionCall.arguments);

  await safeEmitProgress(onProgress, {
    type: 'tool_start',
    toolName,
    arguments: args
  });

  try {
    if (!tools.hasTool(toolName)) {
      throw new Error(`Unknown AI Assist tool: ${toolName}`);
    }

    const result = await tools.runTool(req, toolName, args);
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
      output: {
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: stringifyToolOutput(result)
      }
    };
  } catch (error) {
    const result = {
      error: error instanceof Error ? error.message : 'Tool execution failed'
    };
    const durationMs = Date.now() - startedAt;

    await safeEmitProgress(onProgress, {
      type: 'tool_done',
      toolName,
      arguments: args,
      status: 'failed',
      durationMs,
      errorMessage: result.error
    });

    return {
      trace: {
        toolName,
        arguments: args,
        result,
        status: 'failed',
        durationMs,
        errorMessage: result.error,
        permissionOutcome: { inheritedUserPermission: true }
      },
      output: {
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: stringifyToolOutput(result)
      }
    };
  }
};

const executeSkillStep = async (req, step, { onProgress } = {}) => {
  const startedAt = Date.now();
  await safeEmitProgress(onProgress, {
    type: 'tool_start',
    toolName: step.toolName,
    arguments: step.args
  });

  if (!tools.hasTool(step.toolName)) {
    throw new Error(`Unknown AI Assist skill tool: ${step.toolName}`);
  }

  const result = await tools.runTool(req, step.toolName, step.args);
  const durationMs = Date.now() - startedAt;
  await safeEmitProgress(onProgress, {
    type: 'tool_done',
    toolName: step.toolName,
    arguments: step.args,
    status: 'success',
    durationMs
  });

  return {
    toolName: step.toolName,
    arguments: step.args,
    result,
    status: 'success',
    durationMs,
    permissionOutcome: { inheritedUserPermission: true }
  };
};

const executeIntentTool = async (req, toolName, args = {}, { onProgress } = {}) => {
  const startedAt = Date.now();
  await safeEmitProgress(onProgress, {
    type: 'tool_start',
    toolName,
    arguments: args
  });
  const result = await tools.runTool(req, toolName, args);
  const durationMs = Date.now() - startedAt;
  await safeEmitProgress(onProgress, {
    type: 'tool_done',
    toolName,
    arguments: args,
    status: 'success',
    durationMs
  });

  return {
    toolName,
    arguments: args,
    result,
    status: 'success',
    durationMs,
    permissionOutcome: { inheritedUserPermission: true }
  };
};

const formatStudentCandidate = (student) => {
  const pieces = [student.name];

  if (student.chineseName) {
    pieces.push(student.chineseName);
  }

  if (student.email) {
    pieces.push(student.email);
  }

  if (student.id) {
    pieces.push(`id: ${student.id}`);
  }

  return pieces.filter(Boolean).join(' | ');
};

const buildStudentResolutionReply = (resolutionResult) => {
  if (resolutionResult.status === 'not_found') {
    return 'No accessible student matched. Please provide full name or email.';
  }

  if (resolutionResult.status === 'ambiguous') {
    const options = (resolutionResult.candidates || [])
      .slice(0, 5)
      .map((candidate, index) => `${index + 1}. ${formatStudentCandidate(candidate)}`)
      .join('\n');

    return `Multiple students matched. Please choose one:\n${options}`;
  }

  return 'Please provide student name or email.';
};

const resolveIntentStudent = async ({ req, assistContext, intentResult }) => {
  if (assistContext?.mentionedStudent?.id) {
    return {
      status: 'resolved',
      student: {
        id: assistContext.mentionedStudent.id,
        name: assistContext.mentionedStudent.displayName || null
      },
      source: 'assist_context',
      trace: []
    };
  }

  if (!intentResult.needsStudentResolution) {
    return {
      status: 'not_needed',
      student: null,
      source: 'intent',
      trace: []
    };
  }

  const resolution = await resolveStudent(req, intentResult.studentQuery);
  const trace = [
    {
      toolName: 'search_accessible_students',
      arguments: { query: intentResult.studentQuery, limit: 10 },
      result: resolution.searchResult || { data: [] },
      status: 'success',
      durationMs: 0,
      permissionOutcome: { inheritedUserPermission: true }
    }
  ];

  return {
    ...resolution,
    source: 'student_search',
    trace
  };
};

const runIntentPlan = async ({
  req,
  intentResult,
  resolvedStudent,
  onProgress
}) => {
  const toolNames = INTENT_TOOL_PLAN[intentResult.intent] || [];
  const trace = [];
  const toolContext = {};

  for (const toolName of toolNames) {
    const toolTrace = await executeIntentTool(req, toolName, {
      studentId: resolvedStudent?.student?.id
    }, { onProgress });
    trace.push(toolTrace);
    toolContext[toolName] = toolTrace.result;
  }

  return {
    trace,
    toolContext
  };
};

const runIntentFirstFlow = async ({
  message,
  req,
  assistContext,
  conversationContext,
  responseLanguageInstruction,
  onProgress,
  onToken
}) => {
  await safeEmitProgress(onProgress, {
    type: 'thinking',
    phase: 'intent_routing',
    message: 'Classifying intent'
  });
  const intentResult = await classifyIntent({
    message,
    conversationContext
  });
  await safeEmitProgress(onProgress, {
    type: 'status',
    phase: 'intent_routing',
    intent: intentResult.intent
  });

  await safeEmitProgress(onProgress, {
    type: 'thinking',
    phase: 'entity_resolution',
    message: 'Resolving student'
  });
  const resolvedStudent = await resolveIntentStudent({
    req,
    assistContext,
    intentResult
  });
  await safeEmitProgress(onProgress, {
    type: 'status',
    phase: 'entity_resolution',
    resolutionStatus: resolvedStudent.status
  });

  if (
    intentResult.needsStudentResolution &&
    resolvedStudent.status !== 'resolved'
  ) {
    return {
      response: undefined,
      answer: buildStudentResolutionReply(resolvedStudent),
      trace: resolvedStudent.trace || [],
      skillTrace: {
        mode: 'general',
        status: 'fallback',
        steps: [],
        fallbackReason: `student_resolution_${resolvedStudent.status}`,
        student: null
      }
    };
  }

  const intentExecution =
    intentResult.intent === 'general'
      ? { trace: [], toolContext: {} }
      : await runIntentPlan({
          req,
          intentResult,
          resolvedStudent,
          onProgress
        });
  await safeEmitProgress(onProgress, {
    type: 'thinking',
    phase: 'answer_composer',
    message: 'Composing answer'
  });
  const composed = await composeAnswer({
    message,
    intentResult,
    conversationContext,
    resolvedStudent: resolvedStudent.student || null,
    toolContext: intentExecution.toolContext,
    responseLanguageInstruction,
    onToken
  });

  return {
    response: composed.response,
    answer: composed.answer,
    trace: [...(resolvedStudent.trace || []), ...intentExecution.trace]
  };
};

const buildSkillSynthesisInput = ({
  message,
  conversationContext,
  resolvedAssistContext,
  toolTrace,
  synthesisInstruction,
  responseLanguageInstruction
}) => [
  {
    role: 'user',
    content: JSON.stringify(
      {
        currentUserMessage: message,
        responseLanguageInstruction,
        conversationContext,
        skillContext: {
          requestedSkill: resolvedAssistContext.requestedSkill,
          resolvedSkill: resolvedAssistContext.resolvedSkill,
          student: resolvedAssistContext.student,
          synthesisInstruction,
          toolResults: toolTrace.map((step) => ({
            toolName: step.toolName,
            description:
              aiAssistToolDefinitionsByName[step.toolName]?.description || null,
            arguments: step.arguments,
            result: step.result,
            status: step.status
          }))
        }
      },
      null,
      2
    )
  }
];

const buildSkillTraceSteps = (trace = []) =>
  trace.map((step) => ({
    toolName: step.toolName,
    status: step.status,
    arguments: step.arguments,
    description: aiAssistToolDefinitionsByName[step.toolName]?.description || null
  }));

const runSkillPlan = async ({
  message,
  req,
  conversationContext,
  resolvedAssistContext,
  responseLanguageInstruction,
  onProgress,
  onToken
}) => {
  const plan = SKILL_PLANS[resolvedAssistContext.resolvedSkill];
  const trace = [];

  for (const createStep of plan.steps) {
    trace.push(
      await executeSkillStep(
        req,
        createStep(resolvedAssistContext.student),
        { onProgress }
      )
    );
  }

  await safeEmitProgress(onProgress, {
    type: 'thinking',
    phase: 'answer_composer',
    message: 'Composing skill answer'
  });
  const {
    response,
    answer
  } = await generateAnswerFromInput({
    onToken,
    instructions: `${instructions} ${languagePolicyInstructions} ${plan.synthesisInstruction} Use only the provided skill data. Do not call tools.`,
    input: buildSkillSynthesisInput({
      message,
      conversationContext,
      resolvedAssistContext,
      toolTrace: trace,
      synthesisInstruction: plan.synthesisInstruction,
      responseLanguageInstruction
    })
  });

  return {
    response,
    answer,
    trace,
    skillTrace: {
      requestedSkill: resolvedAssistContext.requestedSkill || null,
      resolvedSkill: resolvedAssistContext.resolvedSkill,
      mode: 'skill',
      student: resolvedAssistContext.student,
      status: 'completed',
      steps: buildSkillTraceSteps(trace),
      fallbackReason: null
    }
  };
};

const runResponsesToolLoop = async ({
  message,
  req,
  conversationContext,
  responseLanguageInstruction,
  onProgress
}) => {
  let input = buildInitialInput({
    message,
    conversationContext,
    responseLanguageInstruction
  });
  const trace = [];
  let response;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    await safeEmitProgress(onProgress, {
      type: 'thinking',
      phase: 'legacy_tool_loop',
      round: round + 1,
      message: 'Model thinking'
    });
    response = await openAIClient.responses.create({
      model: DEFAULT_MODEL,
      instructions: `${instructions} ${languagePolicyInstructions}`,
      input,
      tools: aiAssistToolDefinitions
    });

    const functionCalls = getFunctionCalls(response);
    if (!functionCalls.length) {
      return {
        response,
        answer: getResponseText(response),
        trace
      };
    }

    const toolResults = await Promise.all(
      functionCalls.map((functionCall) =>
        executeFunctionCall(req, functionCall, { onProgress })
      )
    );
    trace.push(...toolResults.map((toolResult) => toolResult.trace));
    input = [...input, ...functionCalls, ...toolResults.map((item) => item.output)];
  }

  return {
    response,
    answer:
      'AI Assist reached the maximum number of tool calls before producing an answer.',
    trace
  };
};

const runChatFallback = async ({ message, onProgress, onToken }) => {
  await safeEmitProgress(onProgress, {
    type: 'thinking',
    phase: 'chat_fallback',
    message: 'Model thinking'
  });
  if (typeof onToken === 'function') {
    const stream = await openAIClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: instructions
        },
        { role: 'user', content: message }
      ],
      temperature: 0.2,
      stream: true
    });

    let answer = '';
    for await (const part of stream) {
      const chunk = part.choices?.[0]?.delta?.content || '';
      if (chunk) {
        answer += chunk;
        try {
          await onToken(chunk);
        } catch {
          // Token streaming is best-effort.
        }
      }
    }

    return {
      response: {
        id: undefined,
        usage: undefined
      },
      answer,
      trace: []
    };
  }

  const response = await openAIClient.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: instructions
      },
      { role: 'user', content: message }
    ],
    temperature: 0.2
  });

  return {
    response: {
      id: response.id,
      usage: response.usage
    },
    answer: response.choices?.[0]?.message?.content || '',
    trace: []
  };
};

const shouldRunSkillMode = (resolvedAssistContext) =>
  Boolean(
    resolvedAssistContext?.resolvedSkill &&
      !resolvedAssistContext?.fallbackReason &&
      resolvedAssistContext?.student?.id
  );

const shouldUseLegacyToolLoop = (resolvedAssistContext, req) =>
  Boolean(resolvedAssistContext?.fallbackReason) || !req?.db;

const safeEmitProgress = async (onProgress, event) => {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    await onProgress({
      timestamp: new Date().toISOString(),
      ...event
    });
  } catch (error) {
    // Progress events are best-effort.
  }
};

const runAiAssist = async (
  postgres,
  {
    conversationId,
    message,
    req,
    assistContext,
    preferredLanguage,
    onProgress,
    onToken
  }
) => {
  await safeEmitProgress(onProgress, {
    type: 'status',
    phase: 'start',
    message: 'Request received'
  });
  const conversationContext = await loadConversationContext(
    postgres,
    conversationId
  );
  const resolvedAssistContext = resolveAssistContext({
    assistContext,
    conversationContext,
    message
  });
  const userMessage = await createUserMessage(postgres, {
    conversationId,
    content: message,
    skillTrace: buildUserMessageSkillTrace({
      assistContext,
      resolvedAssistContext
    })
  });
  const responseLanguageInstruction = buildResponseLanguageInstruction({
    message,
    assistContext,
    preferredLanguage
  });
  const useSkillMode =
    openAIClient.responses?.create && shouldRunSkillMode(resolvedAssistContext);
  let result;

  if (useSkillMode) {
    await safeEmitProgress(onProgress, {
      type: 'status',
      phase: 'mode',
      mode: 'skill'
    });
    result = await runSkillPlan({
      message,
      req,
      conversationContext,
      resolvedAssistContext,
      responseLanguageInstruction,
      onProgress,
      onToken
    });
  } else if (
    openAIClient.responses?.create &&
    shouldUseLegacyToolLoop(resolvedAssistContext, req)
  ) {
    await safeEmitProgress(onProgress, {
      type: 'status',
      phase: 'mode',
      mode: 'legacy_tool_loop'
    });
    result = await runResponsesToolLoop({
      message,
      req,
      conversationContext,
      responseLanguageInstruction,
      onProgress
    });
  } else if (openAIClient.responses?.create) {
    await safeEmitProgress(onProgress, {
      type: 'status',
      phase: 'mode',
      mode: 'intent_first'
    });
    result = await runIntentFirstFlow({
      message,
      req,
      assistContext,
      conversationContext,
      responseLanguageInstruction,
      onProgress,
      onToken
    });
  } else {
    await safeEmitProgress(onProgress, {
      type: 'status',
      phase: 'mode',
      mode: 'chat_fallback'
    });
    result = await runChatFallback({ message, onProgress, onToken });
  }
  const answer = result.answer || 'No answer was returned by AI Assist.';
  const fallbackReason =
    result.skillTrace?.fallbackReason || resolvedAssistContext.fallbackReason;
  const nonSkillStatus = fallbackReason ? 'fallback' : 'completed';
  const assistantMessage = await createAssistantMessage(postgres, {
    conversationId,
    content: answer,
    response: result.response,
    skillTrace:
      result.skillTrace ||
      buildSkillTrace({
        requestedSkill: resolvedAssistContext.requestedSkill,
        resolvedSkill: resolvedAssistContext.resolvedSkill,
        unknownSkillText: resolvedAssistContext.unknownSkillText,
        mode: useSkillMode ? 'skill' : 'general',
        student: resolvedAssistContext.student,
        status: useSkillMode ? 'completed' : nonSkillStatus,
        steps: [],
        fallbackReason
      })
  });
  const trace = await Promise.all(
    result.trace.map((toolCall) =>
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

  await safeEmitProgress(onProgress, {
    type: 'status',
    phase: 'completed',
    traceCount: trace.length
  });

  return {
    userMessage,
    assistantMessage,
    answer,
    trace,
    skillTrace: assistantMessage?.skillTrace || result.skillTrace || null,
    usage: result.response?.usage
  };
};

module.exports = {
  autoDetectSkill,
  resolveAssistContext,
  runAiAssist
};
