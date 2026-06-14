import axios from 'axios';
import {
  isDev,
  SLACK_BOT_TOKEN,
  SLACK_TAIGER_WIN_CHANNEL_ID,
  SLACK_DEVELOPER_ID,
  SLACK_NOTIFICATIONS_LOG_CHANNEL_ID
} from '../config';

import {
  PROGRAM_URL,
  BASE_DOCUMENT_FOR_AGENT_URL,
  STUDENT_APPLICATION_STUDENT_URL
} from '../constants';

import logger from '../services/logger';

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
  const contributors = [...agents, ...editors]
    .filter((contributor) => !contributor.archiv)
    .map((contributor) => {
      const slackId = contributor?.slackId;
      if (typeof slackId === 'string' && slackId !== '') {
        return `<@${slackId}>`;
      }

      const firstName = contributor?.firstname || '';
      const lastName = contributor?.lastname || '';
      return `${firstName} ${lastName}`.trim() || 'a TaiGer contributor';
    });

  const studentLink = BASE_DOCUMENT_FOR_AGENT_URL(student._id);
  const programLink = PROGRAM_URL(application.programId._id);
  const studentName = `${student.firstname} ${student.lastname}`;
  const programLabel = `${application.programId.school} - ${application.programId.program_name} (${application.programId.degree})`;
  const specialThanks =
    contributors.length > 0
      ? contributors.length === 1
        ? contributors[0]
        : `${contributors.slice(0, -1).join(', ')}, and ${
            contributors[contributors.length - 1]
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

/**
 * Posts a copy of a staff DM notification to the notifications log channel,
 * so agent/editor managers can audit what was sent and to whom.
 */
async function logStaffNotificationToManagers(editor, message, note) {
  if (!SLACK_NOTIFICATIONS_LOG_CHANNEL_ID) {
    return;
  }

  const recipient =
    typeof editor?.slackId === 'string' && editor.slackId
      ? `<@${editor.slackId}>`
      : `${editor?.firstname || ''} ${editor?.lastname || ''}`.trim() ||
        'a TaiGer contributor';

  const quotedMessage = message
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

  const noteLine = note ? `${note}\n` : '';

  try {
    await sendSlackMessage(
      `Message sent to ${recipient}:\n${noteLine}${quotedMessage}`,
      SLACK_NOTIFICATIONS_LOG_CHANNEL_ID,
      undefined,
      {
        unfurl_links: false,
        unfurl_media: false
      }
    );
  } catch (error) {
    logger.error(
      `Failed to log Slack notification to managers: ${error.message || error}`
    );
  }
}

/**
 * Notifies a student's editors via Slack DM that an application has been
 * withdrawn or re-activated, so they know whether it still needs work.
 */
async function sendApplicationWithdrawNotificationToEditors(
  student,
  application,
  isWithdrawn
) {
  const editors = (student.editors || []).filter(
    (editor) =>
      !editor.archiv && typeof editor?.slackId === 'string' && editor.slackId
  );

  if (editors.length === 0) {
    return;
  }

  const studentLink = STUDENT_APPLICATION_STUDENT_URL(student._id);
  const programLink = PROGRAM_URL(application.programId._id);
  const studentName = `${student.firstname} ${student.lastname}`;
  const programLabel = `${application.programId.school} - ${application.programId.program_name} (${application.programId.degree})`;

  const slackMessage = isWithdrawn
    ? `🚫 Application withdrawn\n\n` +
      `• Student: <${studentLink}|${studentName}>\n` +
      `• Program: <${programLink}|${programLabel}>\n\n` +
      `This application has been withdrawn and no longer needs to be processed or worked on.`
    : `↩️ Application reinstated\n\n` +
      `• Student: <${studentLink}|${studentName}>\n` +
      `• Program: <${programLink}|${programLabel}>\n\n` +
      `This application has been un-withdrawn and needs to be processed again.`;

  for (const editor of editors) {
    let channel = editor.slackId;
    let messageToSend = slackMessage;
    let skipSend = false;
    let devRedirectNote;

    if (isDev()) {
      if (!SLACK_DEVELOPER_ID) {
        skipSend = true;
        logger.info(
          `[dev] Slack application withdraw notification to editor ${editor._id} (${editor.slackId}) skipped, no SLACK_DEVELOPER_ID set:\n${slackMessage}`
        );
      } else {
        channel = SLACK_DEVELOPER_ID;
        devRedirectNote = `[dev] This message was redirected to <@${SLACK_DEVELOPER_ID}>`;
        messageToSend = `${devRedirectNote}\n\n${slackMessage}`;
      }
    }

    if (!skipSend) {
      try {
        await sendSlackMessage(messageToSend, channel, undefined, {
          unfurl_links: false,
          unfurl_media: false
        });
      } catch (error) {
        logger.error(
          `Failed to send Slack application withdraw notification to editor ${
            editor._id
          }: ${error.message || error}`
        );
      }
    }

    await logStaffNotificationToManagers(editor, slackMessage, devRedirectNote);
  }
}

module.exports = {
  sendSlackMessage,
  sendSlackMessageToWinChannel,
  sendApplicationWithdrawNotificationToEditors
};
