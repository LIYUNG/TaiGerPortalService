import { createTransport } from 'nodemailer';
import {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USERNAME,
  SMTP_PASSWORD,
  isProd,
  isTest
} from '../../config';
import { sesv2Client, SendEmailCommand, limiter } from '../../aws';
import { senderName, taigerNotReplyGmail } from '../../constants/email';
import { htmlContent } from '../emailTemplate';
import logger from '../logger';

// SES API v2 transport (nodemailer 9+). v2 `SendEmail` (raw content) allows ~40
// MB messages vs v1 `SendRawEmail`'s 10 MB cap — required for forwarding
// document bundles. All emails go through this transport in production.
const transporter = isProd()
  ? createTransport({
      SES: { sesClient: sesv2Client, SendEmailCommand }
    })
  : createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      auth: {
        user: SMTP_USERNAME,
        pass: SMTP_PASSWORD
      },
      tls: {
        rejectUnauthorized: false
      }
    });

const sendEmail = isTest()
  ? (_to, _subject, _message) => {}
  : async (to, subject, message) => {
      const mail = {
        from: senderName,
        to,
        bcc: taigerNotReplyGmail,
        subject,
        html: htmlContent(message)
      };

      try {
        return await limiter.schedule(() => transporter.sendMail(mail));
      } catch (error) {
        logger.error('Failed to send email', { to, subject, error });
        return null;
      }
    };

// Sends a single email with file attachments and explicit cc/bcc support.
// Unlike `sendEmail`, this re-throws on failure so callers can surface the
// error to the user (e.g. an agent forwarding documents). `to`/`cc`/`bcc` are
// arrays of already-validated email strings; `attachments` are nodemailer
// `{ filename, content: Buffer }` entries. The no-reply mailbox is always
// bcc'd to keep an audit copy (mirrors `sendEmail`).
const sendEmailWithAttachments = isTest()
  ? async (_args) => ({ accepted: [], messageId: 'test' })
  : async ({ to, cc, bcc, subject, message, attachments }) => {
      const mail = {
        from: senderName,
        to,
        ...(cc && cc.length ? { cc } : {}),
        bcc: [taigerNotReplyGmail, ...(bcc || [])],
        subject,
        html: htmlContent(message),
        attachments
      };

      return limiter.schedule(() => transporter.sendMail(mail));
    };

export = { transporter, sendEmail, sendEmailWithAttachments };
