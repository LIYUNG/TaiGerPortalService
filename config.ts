import path from 'path';
import dotenv from 'dotenv';

export const isProd = () => process.env.NODE_ENV === 'production';
const isBeta = () => process.env.NODE_ENV === 'beta';
export const isInPipeline = () => isBeta() || isProd();
export const isTest = () => process.env.NODE_ENV === 'test';
export const isLocal = () =>
  process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'test';

// TODO: if later use Docker CICD, .env is not needed and env variables are
// injected from secret manager during deployment
if (isLocal() || isTest()) {
  dotenv.config({
    path: path.join(__dirname, `./.env.${isLocal() ? 'development' : 'test'}`)
  });
}

// FIXME: throw error if both env variable and default not set
// Overloaded so each exported constant keeps a clean type (string OR number)
// instead of a `string | number` union — numeric env values are coerced.
function env(name: string, default_: string): string;
function env(name: string, default_: number): number;
function env(name: string, default_: string | number): string | number {
  const value = process.env[name];
  if (value === undefined || value === '') return default_;
  return typeof default_ === 'number' ? Number(value) : value;
}

export const PORT = env('PORT', 3000);
export const HTTPS_KEY = env('HTTPS_KEY', './cert/selfsigned.key');
export const HTTPS_CERT = env('HTTPS_CERT', './cert/selfsigned.pem');
export const HTTPS_CA = env('HTTPS_CA', './cert/selfsigned.pem');
export const ORIGIN = env('ORIGIN', 'http://localhost:3006');
export const TENANT_ID = env('TENANT_ID', 'TaiGer');
// TODO: remove some of the default values
export const MONGODB_URI = env(
  'MONGODB_URI',
  'mongodb://localhost:27017/TaiGer'
);
export const POSTGRES_URI = env(
  'POSTGRES_URI',
  'postgresql://localhost:5432/TaiGer'
);
export const JWT_SECRET = env('JWT_SECRET', 'topsecret');
export const JWT_EXPIRE = env('JWT_EXPIRE', '1hr');
export const SMTP_HOST = env('SMTP_HOST', 'smtp.ethereal.email');
export const SMTP_PORT = env('SMTP_PORT', 587);
export const SMTP_USERNAME = env(
  'SMTP_USERNAME',
  'glen.simonis12@ethereal.email'
);
export const SMTP_PASSWORD = env('SMTP_PASSWORD', 'PASSWORD');
export const UPLOAD_PATH = env('UPLOAD_PATH', '');
export const CLEAN_UP_SCHEDULE = env('CLEAN_UP_SCHEDULE', '* * * 1 * *');
export const WEEKLY_TASKS_REMINDER_SCHEDULE = env(
  'WEEKLY_TASKS_REMINDER_SCHEDULE',
  '0 5 0 * * 5'
);
export const DAILY_TASKS_REMINDER_SCHEDULE = env(
  'DAILY_TASKS_REMINDER_SCHEDULE',
  '0 5 0 * * *'
);
export const COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE = env(
  'COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE',
  '2 5 3 * 6 5'
);
export const COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE = env(
  'COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE',
  '2 5 3 * 7 5'
);
export const COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE = env(
  'COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE',
  '2 5 3 * 11 5'
);
export const COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE = env(
  'COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE',
  '2 5 3 * 12 5'
);
export const AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE = env(
  'AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE',
  '0 0 23 * * *'
);
export const ESCALATION_DEADLINE_DAYS_TRIGGER = env(
  'ESCALATION_DEADLINE_DAYS_TRIGGER',
  30
);
export const AWS_S3_PUBLIC_BUCKET = env('AWS_S3_PUBLIC_BUCKET', '');
export const AWS_REGION = env('AWS_REGION', 'us-east-1');
export const AWS_S3_ACCESS_KEY_ID = env('AWS_S3_ACCESS_KEY_ID', '');
export const AWS_S3_ACCESS_KEY = env('AWS_S3_ACCESS_KEY', '');
export const AWS_S3_PUBLIC_BUCKET_NAME = env('AWS_S3_PUBLIC_BUCKET_NAME', '');
export const AWS_S3_BUCKET_NAME = env('AWS_S3_BUCKET_NAME', '');
export const AWS_TRANSCRIPT_ANALYSER_ROLE = env(
  'AWS_TRANSCRIPT_ANALYSER_ROLE',
  'arn:aws:iam::669131042313:role/transcript-analyzer-role-beta'
);
export const AWS_TRANSCRIPT_ANALYSER_APIG_URL = env(
  'AWS_TRANSCRIPT_ANALYSER_APIG_URL',
  'https://beta.course.taigerconsultancy-portal.com/analyze'
);
export const OPENAI_API_KEY = env('OPENAI_API_KEY', '');
export const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY', '');
// AI Assist LLM provider selection. 'openai' (default) or 'anthropic'.
export const AI_ASSIST_PROVIDER = env('AI_ASSIST_PROVIDER', 'openai');
// Model override for the selected provider. Defaults to OpenAI's latest mini
// model; set empty to let the provider pick its own default.
export const AI_ASSIST_MODEL = env('AI_ASSIST_MODEL', 'gpt-5.4-mini');
export const GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID', '');
export const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET', '');
export const GOOGLE_REDIRECT_URL = env('GOOGLE_REDIRECT_URL', '');
export const CRM_API_TARGET = env('CRM_API_TARGET', '');
export const FIREFLIES_API_URL = env(
  'FIREFLIES_API_URL',
  'https://api.fireflies.ai/graphql'
);
export const FIREFLIES_API_TOKEN = env('FIREFLIES_API_TOKEN', '');
export const FIREFLIES_GOOGLE_INVITE_N8N_URL = env(
  'FIREFLIES_GOOGLE_INVITE_N8N_URL',
  ''
);
export const SLACK_BOT_TOKEN = env('SLACK_BOT_TOKEN', '');
export const SLACK_TAIGER_WIN_CHANNEL_ID = env(
  'SLACK_TAIGER_WIN_CHANNEL_ID',
  ''
);
export const SLACK_DEVELOPER_ID = env('SLACK_DEVELOPER_ID', '');
export const SLACK_NOTIFICATIONS_LOG_CHANNEL_ID = env(
  'SLACK_NOTIFICATIONS_LOG_CHANNEL_ID',
  ''
);
