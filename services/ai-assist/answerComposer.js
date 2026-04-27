const { OpenAiModel, openAIClient } = require('../openai');

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';

const ANSWER_INSTRUCTIONS = `You are TaiGer Portal AI Assist.
Use provided context to answer.
Never answer from memory when portal data is needed.
Never guess student identity.
If multiple students match, ask user to choose.
Only mention data returned by tools.
Be concise and cite which portal section data came from.
Do not expose internal IDs unless needed for disambiguation.`;

const getResponseText = (response) => {
  if (response?.output_text) {
    return response.output_text;
  }

  const message = (response?.output || []).find((item) => item.type === 'message');
  return (message?.content || [])
    .map((part) => part.text || part.content || '')
    .filter(Boolean)
    .join('\n');
};

const safeEmitToken = async (onToken, token) => {
  if (typeof onToken !== 'function' || !token) {
    return;
  }

  try {
    await onToken(token);
  } catch {
    // Token streaming is best-effort.
  }
};

const generateAnswerFromInput = async ({ instructions, input, onToken }) => {
  const requestPayload = {
    model: DEFAULT_MODEL,
    instructions,
    input
  };

  if (
    typeof onToken === 'function' &&
    typeof openAIClient.responses?.stream === 'function'
  ) {
    const stream = await openAIClient.responses.stream(requestPayload);
    let streamedText = '';

    for await (const event of stream) {
      if (
        event?.type === 'response.output_text.delta' &&
        typeof event.delta === 'string' &&
        event.delta
      ) {
        streamedText += event.delta;
        await safeEmitToken(onToken, event.delta);
      }
    }

    const response = await stream.finalResponse();

    return {
      response,
      answer: streamedText || getResponseText(response)
    };
  }

  const response = await openAIClient.responses.create(requestPayload);
  return {
    response,
    answer: getResponseText(response)
  };
};

const composeAnswer = async ({
  message,
  intentResult,
  conversationContext,
  resolvedStudent,
  toolContext,
  responseLanguageInstruction,
  onToken
}) => {
  if (!openAIClient.responses?.create) {
    return {
      response: undefined,
      answer: ''
    };
  }

  return generateAnswerFromInput({
    onToken,
    instructions: `${ANSWER_INSTRUCTIONS} Follow responseLanguageInstruction exactly.`,
    input: [
      {
        role: 'user',
        content: JSON.stringify(
          {
            currentUserMessage: message,
            responseLanguageInstruction,
            intentResult,
            conversationContext,
            resolvedStudent: resolvedStudent || null,
            toolContext
          },
          null,
          2
        )
      }
    ]
  });
};

module.exports = {
  composeAnswer,
  generateAnswerFromInput
};
