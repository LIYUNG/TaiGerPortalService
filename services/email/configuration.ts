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
  ? (to, subject, message) => {}
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

module.exports = { transporter, sendEmail };
