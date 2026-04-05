const axios = require('axios');
const { SLACK_BOT_TOKEN, SLACK_TAIGER_WIN_CHANNEL_ID } = require('../config');

const { PROGRAM_URL, BASE_DOCUMENT_FOR_AGENT_URL } = require('../constants');

const logger = require('../services/logger');

/**
 * Internal sender for Slack chat.postMessage
 */
async function postToSlack({ channel, text, blocks, options = {} }) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error('Missing Slack bot token. Set SLACK_BOT_TOKEN.');
  }

  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      { channel, text, blocks, ...options },
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
async function sendSlackMessage(text, channel, blocks, options = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('Message text is required.');
  }

  if (!channel || typeof channel !== 'string') {
    throw new Error('Slack channel is required.');
  }

  if (blocks && !Array.isArray(blocks)) {
    throw new Error('Slack blocks must be an array when provided.');
  }

  if (options && typeof options !== 'object') {
    throw new Error('Slack options must be an object when provided.');
  }

  return postToSlack({ channel, text, blocks, options });
}

async function sendSlackMessageToWinChannel(student, application) {
  const agents = student.agents || [];
  const editors = student.editors || [];
  const contributor = [...agents, ...editors]
    .filter((contributor) => !contributor.archiv)
    .map((contributor) => `${contributor.firstname} ${contributor.lastname}`);

  const studentLink = BASE_DOCUMENT_FOR_AGENT_URL(student._id);
  const programLink = PROGRAM_URL(application.programId._id);
  const studentName = `${student.firstname} ${student.lastname}`;
  const programLabel = `${application.programId.school} - ${application.programId.program_name} (${application.programId.degree})`;
  const specialThanks =
    contributor.length > 0
      ? contributor.length === 1
        ? contributor[0]
        : `${contributor.slice(0, -1).join(', ')}, and ${
            contributor[contributor.length - 1]
          }`
      : 'the TaiGer team';

  const slackMessage =
    `🎉 Admission secured!\n\n` +
    `• Student: <${studentLink}|${studentName}>\n` +
    `• Offer: <${programLink}|${programLabel}>\n\n` +
    `🙌 Thanks to ${specialThanks} for the support. Great teamwork!`;

  const slackBlocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🎉 Admission secured!'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `• *Student:* <${studentLink}|${studentName}>\n` +
          `• *Offer:* <${programLink}|${programLabel}>`
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🙌 Thanks to ${specialThanks} for the support. Great teamwork!`
        }
      ]
    }
  ];

  try {
    await sendSlackMessage(
      slackMessage,
      SLACK_TAIGER_WIN_CHANNEL_ID,
      slackBlocks,
      {
        unfurl_links: false,
        unfurl_media: false
      }
    );
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
