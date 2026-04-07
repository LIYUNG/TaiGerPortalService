const { createTransport } = require('nodemailer');
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USERNAME,
  SMTP_PASSWORD,
  isProd,
  isTest
} = require('../../config');
const { ses, limiter, SendRawEmailCommand } = require('../../aws');
const { senderName, taigerNotReplyGmail } = require('../../constants/email');
const { htmlContent } = require('../emailTemplate');
const logger = require('../logger');

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
