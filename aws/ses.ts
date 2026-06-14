import { SES, SendRawEmailCommand } from '@aws-sdk/client-ses';

import Bottleneck from 'bottleneck/es5';
import { AWS_REGION } from '../config';

const ses = new SES({
  region: AWS_REGION
});

const limiter = new Bottleneck({
  minTime: 1100 / 14
});

export = {
  ses,
  SendRawEmailCommand,
  limiter
};
