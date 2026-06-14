import { isProd, SMTP_USERNAME } from '../config';

const appDomain = 'taigerconsultancy-portal.com';
const senderEmail = isProd()
  ? 'no-reply@taigerconsultancy-portal.com'
  : SMTP_USERNAME;
const taigerNotReplyGmail = 'noreply.taigerconsultancy@gmail.com';
const senderName = `No-Reply TaiGer Consultancy ${senderEmail}`;

export = { appDomain, senderEmail, taigerNotReplyGmail, senderName };
