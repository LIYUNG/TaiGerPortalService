const {
  AWS_TRANSCRIPT_ANALYSER_ROLE,
  AWS_TRANSCRIPT_ANALYSER_APIG_URL,
  isProd,
  AWS_REGION,
  AWS_S3_ACCESS_KEY_ID,
  AWS_S3_ACCESS_KEY
} = require('../config');

// AWS configuration
const roleToAssumeForCourseAnalyzerAPIG = AWS_TRANSCRIPT_ANALYSER_ROLE;

// Transcript Analyser API Gateway URL
const apiGatewayUrl = AWS_TRANSCRIPT_ANALYSER_APIG_URL;

const AWS_KEY_CONFIG = isProd()
  ? { region: AWS_REGION }
  : {
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: AWS_S3_ACCESS_KEY
      }
    };

module.exports = {
  roleToAssumeForCourseAnalyzerAPIG,
  apiGatewayUrl,
  AWS_KEY_CONFIG
};
