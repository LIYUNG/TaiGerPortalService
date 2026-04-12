const { OpenAiModel, openAIClient } = require('../openai');
const {
  aiAssistMessages,
  aiAssistToolCalls
} = require('../../drizzle/schema/schema');
const { runTool } = require('./tools');

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';

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

const createAssistantMessage = (postgres, { conversationId, content, response }) =>
  insertReturningOne(postgres, aiAssistMessages, {
    conversationId,
    role: 'assistant',
    content,
    model: DEFAULT_MODEL,
    responseId: response?.id,
    usage: response?.usage
  });

const createToolCall = (postgres, values) =>
  insertReturningOne(postgres, aiAssistToolCalls, values);

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '');

const inferIntent = (message) => {
  const normalized = normalizeText(message);
  return {
    applications:
      /application|admission|apply|status/.test(normalized) ||
      /\u7533\u8acb|\u9304\u53d6|\u72c0\u6cc1|\u9032\u5ea6|\u7d50\u679c/.test(
        message
      ),
    communications:
      /message|communication|conversation|chat/.test(normalized) ||
      /\u8a0a\u606f|\u4fe1\u606f|\u5c0d\u8a71|\u6e9d\u901a|\u7559\u8a00/.test(
        message
      ),
    documents:
      /document|profile|cv|essay/.test(normalized) ||
      /\u6587\u4ef6|\u5c65\u6b77|\u6587\u66f8/.test(message),
    summary:
      /summary|summarize|overview/.test(normalized) ||
      /\u5b78\u751f|\u6982\u6cc1|\u6458\u8981/.test(message)
  };
};

const getStudentId = (student) => student?.id || student?._id?.toString?.();

const resolveStudent = (message, students = []) => {
  if (!students.length) {
    return undefined;
  }

  if (students.length === 1) {
    return students[0];
  }

  const normalizedMessage = normalizeText(message);
  return students.find((student) =>
    [student.name, student.chineseName, student.email]
      .filter(Boolean)
      .some((value) => normalizedMessage.includes(normalizeText(value)))
  );
};

const buildModelInput = ({ message, toolContext }) =>
  JSON.stringify(
    {
      userQuestion: message,
      toolContext
    },
    null,
    2
  );

const runModel = async ({ message, toolContext }) => {
  const input = buildModelInput({ message, toolContext });

  if (openAIClient.responses?.create) {
    return openAIClient.responses.create({
      model: DEFAULT_MODEL,
      instructions:
        'You are TaiGer AI Assist. Answer only from TaiGer Portal data in toolContext. Use the same language as the user. If multiple students match, ask the user to choose one and list concise candidates. If a user names a student, prefer the closest match by name, chineseName, or email. Never claim you cannot access TaiGer data when toolContext contains relevant data.',
      input
    });
  }

  const response = await openAIClient.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are TaiGer AI Assist. Answer only from TaiGer Portal data in toolContext. Use the same language as the user. If multiple students match, ask the user to choose one and list concise candidates. If a user names a student, prefer the closest match by name, chineseName, or email. Never claim you cannot access TaiGer data when toolContext contains relevant data.'
      },
      { role: 'user', content: input }
    ],
    temperature: 0.2
  });

  return {
    id: response.id,
    output_text: response.choices?.[0]?.message?.content || '',
    usage: response.usage
  };
};

const runAiAssist = async (postgres, { conversationId, message, req }) => {
  const userMessage = await createUserMessage(postgres, {
    conversationId,
    content: message
  });
  const toolCalls = [];
  const runTimedTool = async (toolName, args) => {
    const startedAt = Date.now();
    const result = await runTool(req, toolName, args);
    toolCalls.push({
      toolName,
      arguments: args,
      result,
      status: 'success',
      durationMs: Date.now() - startedAt
    });
    return result;
  };
  const searchArgs = {
    query: message,
    limit: 10
  };
  const toolResult = await runTimedTool(
    'search_accessible_students',
    searchArgs
  );
  const intent = inferIntent(message);
  const resolvedStudent = resolveStudent(message, toolResult.data);
  const resolvedStudentId = getStudentId(resolvedStudent);
  const toolContext = {
    search_accessible_students: toolResult
  };

  if (resolvedStudentId) {
    if (intent.summary || intent.applications || intent.communications) {
      toolContext.get_student_summary = await runTimedTool(
        'get_student_summary',
        {
          studentId: resolvedStudentId
        }
      );
    }

    if (intent.applications) {
      toolContext.get_student_applications = await runTimedTool(
        'get_student_applications',
        {
          studentId: resolvedStudentId
        }
      );
    }

    if (intent.communications) {
      toolContext.get_latest_communications = await runTimedTool(
        'get_latest_communications',
        {
          studentId: resolvedStudentId,
          limit: 10
        }
      );
    }

    if (intent.documents) {
      toolContext.get_profile_documents = await runTimedTool(
        'get_profile_documents',
        {
          studentId: resolvedStudentId
        }
      );
    }
  }

  const response = await runModel({ message, toolContext });
  const answer = response.output_text || 'No answer was returned by AI Assist.';
  const assistantMessage = await createAssistantMessage(postgres, {
    conversationId,
    content: answer,
    response
  });
  const trace = await Promise.all(
    toolCalls.map((toolCall) =>
      createToolCall(postgres, {
        conversationId,
        assistantMessageId: assistantMessage.id,
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        result: toolCall.result,
        status: toolCall.status,
        durationMs: toolCall.durationMs,
        permissionOutcome: { inheritedUserPermission: true }
      })
    )
  );

  return {
    userMessage,
    assistantMessage,
    answer,
    trace,
    usage: response.usage
  };
};

module.exports = {
  runAiAssist
};
