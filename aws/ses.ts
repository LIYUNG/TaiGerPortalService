const { SES, SendRawEmailCommand } = require('@aws-sdk/client-ses');

const Bottleneck = require('bottleneck/es5');
const { AWS_REGION } = require('../config');

const ses = new SES({
  region: AWS_REGION
});

const limiter = new Bottleneck({
  minTime: 1100 / 14
});

module.exports = {
  ses,
  SendRawEmailCommand,
  limiter
};
