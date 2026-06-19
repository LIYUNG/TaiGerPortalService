import { isProd, SMTP_USERNAME } from '../config';

export const appDomain = 'taigerconsultancy-portal.com';
export const senderEmail = isProd()
  ? 'no-reply@taigerconsultancy-portal.com'
  : SMTP_USERNAME;
export const taigerNotReplyGmail = 'noreply.taigerconsultancy@gmail.com';
export const senderName = `No-Reply TaiGer Consultancy ${senderEmail}`;
