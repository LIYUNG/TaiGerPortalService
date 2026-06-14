const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');

const logger = require('../services/logger');
const { AWS_KEY_CONFIG } = require('./constants');

const stsClient = new STSClient(AWS_KEY_CONFIG);

const getTemporaryCredentials = async (roleToAssumeArn) => {
  try {
    // Returns a set of temporary security credentials that you can use to
    // access Amazon Web Services resources that you might not normally
    // have access to.
    const command = new AssumeRoleCommand({
      // The Amazon Resource Name (ARN) of the role to assume.
      RoleArn: roleToAssumeArn,
      // An identifier for the assumed role session.
      RoleSessionName: 'session2',
      // The duration, in seconds, of the role session. The value specified
      // can range from 900 seconds (15 minutes) up to the maximum session
      // duration set for the role.
      DurationSeconds: 900
    });
    const response = await stsClient.send(command);
    logger.info(response);
    return response;
  } catch (err) {
    logger.error(err);
  }
};

module.exports = {
  getTemporaryCredentials
};
