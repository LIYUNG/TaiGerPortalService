const { OpenAI } = require('openai');

const { OPENAI_API_KEY } = require('../../config');

const openAIClient = new OpenAI({ apiKey: OPENAI_API_KEY });

const OpenAiModel = {
  GPT_3_5_TURBO: 'gpt-3.5-turbo',
  GPT_4_o: 'gpt-4o',
  GPT_5_4_mini: 'gpt-5.4-mini',
  GPT_5_4_nano: 'gpt-5.4-nano'
};

module.exports = { openAIClient, OpenAiModel };
