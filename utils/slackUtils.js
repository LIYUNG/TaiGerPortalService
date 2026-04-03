const axios = require('axios');
const { SLACK_BOT_TOKEN } = require('../config');

/**
 * Internal sender for Slack chat.postMessage
 */
async function postToSlack({ channel, text }) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error('Missing Slack bot token. Set SLACK_BOT_TOKEN.');
  }

  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      { channel, text },
      {
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data;
    if (!data?.ok) {
      throw new Error(`Slack API error: ${data?.error || 'unknown_error'}`);
    }

    return data;
  } catch (error) {
    const errorMessage =
      error?.response?.data?.error || error?.message || 'Unknown error';
    throw new Error(`Slack API error: ${errorMessage}`);
  }
}

/**
 * General purpose sender.
 */
async function sendSlackMessage(text, channel) {
  if (!text || typeof text !== 'string') {
    throw new Error('Message text is required.');
  }

  if (!channel || typeof channel !== 'string') {
    throw new Error('Slack channel is required.');
  }

  return postToSlack({ channel, text });
}

module.exports = {
  sendSlackMessage
};
