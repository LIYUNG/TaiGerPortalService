import { createTransport } from 'nodemailer';
import {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USERNAME,
  SMTP_PASSWORD,
  isProd,
  isTest
} from '../../config';
import { ses, limiter, SendRawEmailCommand } from '../../aws';
import { senderName, taigerNotReplyGmail } from '../../constants/email';
import { htmlContent } from '../emailTemplate';
import logger from '../logger';

const transporter = isProd()
  ? createTransport({
      SES: { ses, aws: { SendRawEmailCommand } }
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
