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

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';
const MAX_TOOL_ROUNDS = 6;
const DEFAULT_SKILL_MESSAGE_LIMIT = 10;

const instructions =
  'You are TaiGer AI Assist. Answer only from TaiGer Portal data returned by tools. Match the user\'s current language and writing system exactly. Do not switch scripts or translate the user\'s chosen language unless asked. Use tools whenever the user asks about TaiGer students, applications, communications, documents, tickets, or programs. Start by searching for a student when you need a studentId. Use conversationContext to resolve follow-up references such as numbers, names, emails, "he", "she", "他", "她", "這位", or "that student". If multiple students match, ask the user to choose one and list concise candidates. Do not invent tool names, IDs, facts, or future tool calls.';

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

const createUserMessage = (postgres, { conversationId, content }) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'user',
    content
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

const createToolCall = (postgres, values) =>
  insertReturningOne(postgres, aiAssistToolCalls, values);

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
    boundStudentId: conversation?.[0]?.studentId || undefined,
    boundStudentDisplayName:
      conversation?.[0]?.studentDisplayName || undefined,
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

const buildInitialInput = ({ message, conversationContext }) => [
  {
    role: 'user',
    content: JSON.stringify(
      {
        currentUserMessage: message,
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

  if (
    /\b(review[_\s-]?open[_\s-]?tasks|open tasks?|todo|to-do|pending tasks?|checklist)\b/.test(
      normalizedMessage
    )
  ) {
    return 'review_open_tasks';
  }

  if (
    /\b(review[_\s-]?messages|latest messages?|communications?|emails?|conversations?|chat history)\b/.test(
      normalizedMessage
    )
  ) {
    return 'review_messages';
  }

  if (
    /\b(identify[_\s-]?risk|risks?|blockers?|concerns?|issues?|problems?)\b/.test(
      normalizedMessage
    )
  ) {
    return 'identify_risk';
  }

  if (
    /\b(summarize[_\s-]?student|summar(?:y|ize)|overview)\b/.test(
      normalizedMessage
    )
  ) {
    return 'summarize_student';
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
    : conversationContext.boundStudentId
      ? {
          id: conversationContext.boundStudentId,
          displayName: conversationContext.boundStudentDisplayName || null
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
    fallbackReason = 'Skill mode requires a student context.';
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

const executeFunctionCall = async (req, functionCall) => {
  const startedAt = Date.now();
  const toolName = functionCall.name;

  try {
    if (!tools.hasTool(toolName)) {
      throw new Error(`Unknown AI Assist tool: ${toolName}`);
    }

    const args = parseArguments(functionCall.arguments);
    const result = await tools.runTool(req, toolName, args);

    return {
      trace: {
        toolName,
        arguments: args,
        result,
        status: 'success',
        durationMs: Date.now() - startedAt,
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

    return {
      trace: {
        toolName,
        arguments: functionCall.arguments,
        result,
        status: 'failed',
        durationMs: Date.now() - startedAt,
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

const executeSkillStep = async (req, step) => {
  const startedAt = Date.now();

  if (!tools.hasTool(step.toolName)) {
    throw new Error(`Unknown AI Assist skill tool: ${step.toolName}`);
  }

  const result = await tools.runTool(req, step.toolName, step.args);

  return {
    toolName: step.toolName,
    arguments: step.args,
    result,
    status: 'success',
    durationMs: Date.now() - startedAt,
    permissionOutcome: { inheritedUserPermission: true }
  };
};

const buildSkillSynthesisInput = ({
  message,
  conversationContext,
  resolvedAssistContext,
  toolTrace,
  synthesisInstruction
}) => [
  {
    role: 'user',
    content: JSON.stringify(
      {
        currentUserMessage: message,
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
  resolvedAssistContext
}) => {
  const plan = SKILL_PLANS[resolvedAssistContext.resolvedSkill];
  const trace = [];

  for (const createStep of plan.steps) {
    trace.push(await executeSkillStep(req, createStep(resolvedAssistContext.student)));
  }

  const response = await openAIClient.responses.create({
    model: DEFAULT_MODEL,
    instructions: `${instructions} ${plan.synthesisInstruction} Use only the provided skill data. Do not call tools.`,
    input: buildSkillSynthesisInput({
      message,
      conversationContext,
      resolvedAssistContext,
      toolTrace: trace,
      synthesisInstruction: plan.synthesisInstruction
    })
  });

  return {
    response,
    answer: getResponseText(response),
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

const runResponsesToolLoop = async ({ message, req, conversationContext }) => {
  let input = buildInitialInput({ message, conversationContext });
  const trace = [];
  let response;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    response = await openAIClient.responses.create({
      model: DEFAULT_MODEL,
      instructions,
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
      functionCalls.map((functionCall) => executeFunctionCall(req, functionCall))
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

const runChatFallback = async ({ message }) => {
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

const runAiAssist = async (
  postgres,
  { conversationId, message, req, assistContext }
) => {
  const conversationContext = await loadConversationContext(
    postgres,
    conversationId
  );
  const userMessage = await createUserMessage(postgres, {
    conversationId,
    content: message
  });
  const resolvedAssistContext = resolveAssistContext({
    assistContext,
    conversationContext,
    message
  });
  const useSkillMode =
    openAIClient.responses?.create && shouldRunSkillMode(resolvedAssistContext);
  const result = useSkillMode
    ? await runSkillPlan({
        message,
        req,
        conversationContext,
        resolvedAssistContext
      })
    : openAIClient.responses?.create
      ? await runResponsesToolLoop({ message, req, conversationContext })
      : await runChatFallback({ message });
  const answer = result.answer || 'No answer was returned by AI Assist.';
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
        status: useSkillMode ? 'completed' : 'fallback',
        steps: [],
        fallbackReason: resolvedAssistContext.fallbackReason
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

  return {
    userMessage,
    assistantMessage,
    answer,
    trace,
    skillTrace: assistantMessage.skillTrace || result.skillTrace || null,
    usage: result.response?.usage
  };
};

module.exports = {
  autoDetectSkill,
  resolveAssistContext,
  runAiAssist
};
