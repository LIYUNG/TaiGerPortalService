import axios from 'axios';
import mongoose from 'mongoose';
import {
  SLACK_BOT_TOKEN,
  SLACK_TAIGER_WIN_CHANNEL_ID,
  SLACK_DEVELOPER_ID,
  SLACK_NOTIFICATIONS_LOG_CHANNEL_ID,
  isLocal
} from '../config';

import {
  PROGRAM_URL,
  BASE_DOCUMENT_FOR_AGENT_URL,
  STUDENT_APPLICATION_STUDENT_URL
} from '../constants';

import logger from '../services/logger';

interface PostToSlackArgs {
  channel: string;
  text: string;
  blocks?: unknown[];
  options?: Record<string, unknown>;
}

// A populated agent/editor ref (student.agents/editors are populated with
// firstname/lastname/slackId/archiv by the callers — see
// controllers/files.ts and controllers/applications.ts). The `student` param
// below crosses a module boundary as a Mongoose lean/hydrated doc whose exact
// static shape (and whether agents/editors carry populated docs vs raw
// ObjectId refs) varies by caller, so it's accepted as `unknown` and narrowed
// to this shape once at the top of each function, mirroring the same
// populated-at-runtime-but-not-in-the-static-type reality already handled via
// an `any[]` cast in controllers/files.ts.
interface PopulatedContributorRef {
  _id?: mongoose.Types.ObjectId | string;
  firstname?: string;
  lastname?: string;
  slackId?: string;
  archiv?: boolean;
}

interface PopulatedSlackStudent {
  _id: mongoose.Types.ObjectId | string;
  firstname?: string;
  lastname?: string;
  agents?: PopulatedContributorRef[];
  editors?: PopulatedContributorRef[];
}

interface PopulatedProgramRef {
  _id: mongoose.Types.ObjectId | string;
  school?: string;
  program_name?: string;
  degree?: string;
}

// `application` similarly crosses a module boundary; only `programId`
// (populated by the callers via `.populate('programId')`) is read here.
interface PopulatedSlackApplication {
  programId: PopulatedProgramRef;
}

/**
 * Internal sender for Slack chat.postMessage
 */
async function postToSlack({
  channel,
  text,
  blocks,
  options = {}
}: PostToSlackArgs) {
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
    const errorResponse = (
      error as { response?: { data?: { error?: string } } }
    )?.response;
    const errorMessage =
      errorResponse?.data?.error ||
      (error as Error)?.message ||
      'Unknown error';
    throw new Error(`Slack API error: ${errorMessage}`);
  }
}

/**
 * General purpose sender.
 */
export async function sendSlackMessage(
  text: string,
  channel: string,
  blocks?: unknown[],
  options: Record<string, unknown> = {}
) {
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

export async function sendSlackMessageToWinChannel(
  studentInput: unknown,
  applicationInput: unknown
) {
  const student = studentInput as PopulatedSlackStudent;
  const application = applicationInput as PopulatedSlackApplication;
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

  const studentLink = BASE_DOCUMENT_FOR_AGENT_URL(student._id.toString());
  const programLink = PROGRAM_URL(application.programId._id.toString());
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
      `Failed to send Slack admission message: ${
        (error as Error)?.message || error
      }`
    );
  }
}

/**
 * Posts a copy of a staff DM notification to the notifications log channel,
 * so agent/editor managers can audit what was sent and to whom.
 */
async function logStaffNotificationToManagers(
  editor: PopulatedContributorRef,
  message: string,
  note: string | undefined
) {
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
      `Failed to log Slack notification to managers: ${
        (error as Error)?.message || error
      }`
    );
  }
}

/**
 * Notifies a student's editors via Slack DM that an application has been
 * withdrawn or re-activated, so they know whether it still needs work.
 */
export async function sendApplicationWithdrawNotificationToEditors(
  studentInput: unknown,
  applicationInput: unknown,
  isWithdrawn: boolean
) {
  const student = studentInput as PopulatedSlackStudent;
  const application = applicationInput as PopulatedSlackApplication;
  const editors = (student.editors || []).filter(
    (editor): editor is PopulatedContributorRef & { slackId: string } =>
      !editor.archiv && typeof editor?.slackId === 'string' && !!editor.slackId
  );

  if (editors.length === 0) {
    return;
  }

  const studentLink = STUDENT_APPLICATION_STUDENT_URL(student._id.toString());
  const programLink = PROGRAM_URL(application.programId._id.toString());
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

    if (isLocal()) {
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
          }: ${(error as Error)?.message || error}`
        );
      }
    }

    await logStaffNotificationToManagers(editor, slackMessage, devRedirectNote);
  }
}
