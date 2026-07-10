import axios from 'axios';
import { Sha256 } from '@aws-crypto/sha256-browser';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import type { Credentials } from '@aws-sdk/client-sts';

import logger from '../services/logger';
import {
  ses,
  limiter,
  SendRawEmailCommand,
  sesv2Client,
  SendEmailCommand
} from './ses';
import { s3Client } from './s3';
import { getTemporaryCredentials } from './sts';
import { AWS_REGION } from '../config';

export const callApiGateway = async (
  credentials: Credentials,
  apiGatewayUrl: string,
  method: string,
  requestBody: Record<string, unknown> | null = null,
  additionalHeaders: Record<string, string> = {}
) => {
  try {
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: credentials.AccessKeyId ?? '',
        secretAccessKey: credentials.SecretAccessKey ?? '',
        sessionToken: credentials.SessionToken
      },
      region: AWS_REGION,
      service: 'execute-api',
      sha256: Sha256
    });

    const url = new URL(apiGatewayUrl);
    const headers: Record<string, string> = {
      host: url.hostname,
      ...additionalHeaders // Include any additional headers provided
    };
    // Set content type if there is a body
    if (requestBody) {
      headers['Content-Type'] = 'application/json';
    }

    const signedRequest = await signer.sign({
      method,
      hostname: url.hostname,
      path: url.pathname,
      protocol: url.protocol,
      headers,
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
    logger.error('Error calling API Gateway:', { error });
    throw error;
  }
};

// Re-export the AWS clients/commands gathered from the sibling modules so
// callers can import everything from `../aws`.
export {
  s3Client,
  ses,
  SendRawEmailCommand,
  sesv2Client,
  SendEmailCommand,
  limiter,
  getTemporaryCredentials
};
