import { SES, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

import Bottleneck from 'bottleneck/es5';
import { AWS_REGION } from '../config';

// SES API v1 client (legacy). Kept for backward compatibility; the nodemailer
// transport now uses the v2 client below.
const ses = new SES({
  region: AWS_REGION
});

// SES API v2 client. v1 `SendRawEmail` caps the whole message at 10 MB; v2
// `SendEmail` (raw content) allows ~40 MB — needed for forwarding documents.
const sesv2Client = new SESv2Client({
  region: AWS_REGION
});

const limiter = new Bottleneck({
  minTime: 1100 / 14
});

export = {
  ses,
  SendRawEmailCommand,
  sesv2Client,
  SendEmailCommand,
  limiter
};
