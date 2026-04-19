const { desc, eq } = require('drizzle-orm');
const { OpenAiModel, openAIClient } = require('../openai');
const {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} = require('../../drizzle/schema/schema');
const { aiAssistToolDefinitions } = require('./toolDefinitions');
const { registry, runTool } = require('./tools');

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';
const MAX_TOOL_ROUNDS = 6;

const instructions =
  'You are TaiGer AI Assist. Answer only from TaiGer Portal data returned by tools. Match the user\'s current language and writing system exactly. Do not switch scripts or translate the user\'s chosen language unless asked. Use tools whenever the user asks about TaiGer students, applications, communications, documents, tickets, or programs. Start by searching for a student when you need a studentId. Use conversationContext to resolve follow-up references such as numbers, names, emails, "he", "she", "他", "她", "這位", or "that student". If multiple students match, ask the user to choose one and list concise candidates. Do not invent tool names, IDs, facts, or future tool calls.';

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

const buildSkillTrace = (message) => {
  const requestedSkill = message?.match?.(/#([A-Za-z0-9_]+)/)?.[1];

  if (!requestedSkill) {
    return undefined;
  }

  return {
    requestedSkill,
    resolvedSkill: requestedSkill,
    mode: 'skill'
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
    if (!registry[toolName]) {
      throw new Error(`Unknown AI Assist tool: ${toolName}`);
    }

    const args = parseArguments(functionCall.arguments);
    const result = await runTool(req, toolName, args);

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

const runAiAssist = async (
  postgres,
  { conversationId, message, req }
) => {
  const conversationContext = await loadConversationContext(
    postgres,
    conversationId
  );
  const userMessage = await createUserMessage(postgres, {
    conversationId,
    content: message
  });
  const result = openAIClient.responses?.create
    ? await runResponsesToolLoop({ message, req, conversationContext })
    : await runChatFallback({ message });
  const answer = result.answer || 'No answer was returned by AI Assist.';
  const assistantMessage = await createAssistantMessage(postgres, {
    conversationId,
    content: answer,
    response: result.response,
    skillTrace: buildSkillTrace(message)
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
    usage: result.response?.usage
  };
};

module.exports = {
  runAiAssist
};
