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

const composeAnswer = async ({
  message,
  intentResult,
  conversationContext,
  resolvedStudent,
  toolContext,
  responseLanguageInstruction
}) => {
  if (!openAIClient.responses?.create) {
    return {
      response: undefined,
      answer: ''
    };
  }

  const response = await openAIClient.responses.create({
    model: DEFAULT_MODEL,
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

  return {
    response,
    answer: getResponseText(response)
  };
};

module.exports = {
  composeAnswer
};
