const axios = require('axios');
const { Sha256 } = require('@aws-crypto/sha256-browser');
const { SignatureV4 } = require('@aws-sdk/signature-v4');

const logger = require('../services/logger');
const { ses, limiter, SendRawEmailCommand } = require('./ses');
const { s3Client } = require('./s3');
const { getTemporaryCredentials } = require('./sts');
const { AWS_REGION } = require('../config');

const callApiGateway = async (
  credentials,
  apiGatewayUrl,
  method,
  requestBody = null,
  additionalHeaders = {}
) => {
  try {
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken
      },
      region: AWS_REGION,
      service: 'execute-api',
      sha256: Sha256
    });

    const url = new URL(apiGatewayUrl);
    const signedRequest = await signer.sign({
      method,
      hostname: url.hostname,
      path: url.pathname,
      protocol: url.protocol,
      headers: {
        host: url.hostname,
        'Content-Type': requestBody ? 'application/json' : undefined, // Set content type if there is a body
        ...additionalHeaders // Include any additional headers provided
      },
      // Only stringify if there's a body
      body: requestBody ? JSON.stringify(requestBody) : undefined
    });

    const response = await axios({
      ...signedRequest,
      url: apiGatewayUrl,
      method: signedRequest.method,
      headers: signedRequest.headers,
      data: requestBody
    });

    return response.data;
  } catch (error) {
    logger.error('Error calling API Gateway:', error);
    throw error;
  }
};

module.exports = {
  s3Client,
  ses,
  SendRawEmailCommand,
  limiter,
  getTemporaryCredentials,
  callApiGateway
};
