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
// `emailTemplate.ts` uses `export =`; import via `require` interop since a
// named `import { htmlContent }` against an `export =` module is rejected
// under this project's module settings (TS2497).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- export = interop, see comment above
import EmailTemplate = require('../emailTemplate');
import logger from '../logger';

const { htmlContent } = EmailTemplate;

// Recipients are built ad hoc at call sites from user documents whose name/email
// fields are optional on the model (`IUser`), plus an optional `id` used by the
// calendar-invite senders. Kept structurally loose to match what callers pass;
// templates interpolate these fields directly and tolerate `undefined`.
export interface Recipient {
  id?: string | null;
  firstname: string;
  lastname: string;
  address: string;
}

// SES API v2 transport (nodemailer 9+). v2 `SendEmail` (raw content) allows ~40
// MB messages vs v1 `SendRawEmail`'s 10 MB cap — required for forwarding
// document bundles. All emails go through this transport in production.
export const transporter = isProd()
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

export const sendEmail = isTest()
  ? // `to` may be a recipient object or a bare email-address string.
    (_to: Recipient | string, _subject: string, _message: string) => {}
  : async (
      // `to` is a recipient as accepted by nodemailer: an email string, a list
      // of them, or a user-like object ({ firstname, lastname, address/email }).
      // Kept loose because callers pass full user documents.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to: any,
      subject: string,
      message: string
    ) => {
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
export const sendEmailWithAttachments = isTest()
  ? async (_args: {
      // `to`/`cc`/`bcc` are the caller-resolved, already-validated recipient
      // email strings (see forwardStudentDocuments -> resolveStaffEmails).
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      message: string;
      attachments: { filename: string; content: Buffer }[];
    }) => ({ accepted: [], messageId: 'test' })
  : async ({
      to,
      cc,
      bcc,
      subject,
      message,
      attachments
    }: {
      // `to`/`cc`/`bcc` are the caller-resolved, already-validated recipient
      // email strings (see forwardStudentDocuments -> resolveStaffEmails).
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      message: string;
      attachments: { filename: string; content: Buffer }[];
    }) => {
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
