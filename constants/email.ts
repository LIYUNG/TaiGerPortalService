const { isProd, SMTP_USERNAME } = require('../config');

const appDomain = 'taigerconsultancy-portal.com';
const senderEmail = isProd()
  ? 'no-reply@taigerconsultancy-portal.com'
  : SMTP_USERNAME;
const taigerNotReplyGmail = 'noreply.taigerconsultancy@gmail.com';
const senderName = `No-Reply TaiGer Consultancy ${senderEmail}`;

module.exports = { appDomain, senderEmail, taigerNotReplyGmail, senderName };
