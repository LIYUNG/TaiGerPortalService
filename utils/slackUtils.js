const axios = require('axios');
const { SLACK_BOT_TOKEN } = require('../config');
const { SLACK_TAIGER_WIN_CHANNEL_ID } = require('../config');

const { PROGRAM_URL, BASE_DOCUMENT_FOR_AGENT_URL } = require('../constants');

const logger = require('../services/logger');

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

async function sendSlackMessageToWinChannel(student, application) {
  const specialThanks = [...student.agents, ...student.editors]
    .map((agent) => `${agent.firstname} ${agent.lastname}`)
    .join(', ');

  const studentLink = BASE_DOCUMENT_FOR_AGENT_URL(student._id);
  const programLink = PROGRAM_URL(application.programId._id);
  const studentName = `${student.firstname} ${student.lastname}`;
  const programLabel = `${application.programId.school} - ${application.programId.program_name}`;

  const slackMessage =
    `<${studentLink}|${studentName}> has been admitted to program ` +
    `<${programLink}|${programLabel}>. ` +
    `special thanks to: ${specialThanks}`;

  try {
    await sendSlackMessage(slackMessage, SLACK_TAIGER_WIN_CHANNEL_ID);
  } catch (error) {
    logger.error(
      `Failed to send Slack admission message: ${error.message || error}`
    );
  }
}

module.exports = {
  sendSlackMessage,
  sendSlackMessageToWinChannel
};
