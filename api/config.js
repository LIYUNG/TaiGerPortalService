const path = require('path');
const dotenv = require('dotenv');

const isProd = () => process.env.NODE_ENV === 'production';
const isTest = () => process.env.NODE_ENV === 'test';
const isDev = () =>
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

// TODO: if later use Docker CICD, .env is not needed and env variables are
// injected from secret manager during deployment
if (isDev() || isTest()) {
  dotenv.config({
    path: path.join(__dirname, `./.env.${process.env.NODE_ENV}`)
  });
}

// FIXME: throw error if both env variable and default not set
const env = (name, default_) => process.env[name] || default_;

module.exports = {
  isProd,
  isTest,
  isDev,
  PORT: env('PORT', 3000),
  HTTPS_PORT: env('HTTPS_PORT', 3000),
  HTTPS_KEY: env('HTTPS_KEY', './cert/selfsigned.key'),
  HTTPS_CERT: env('HTTPS_CERT', './cert/selfsigned.pem'),
  HTTPS_CA: env('HTTPS_CA', './cert/selfsigned.pem'),
  ORIGIN: env('ORIGIN', 'http://localhost:3006'),
  API_ORIGIN: env('API_ORIGIN', 'http://localhost:3000/api'),
  // TODO: remove some of the default values
  MONGODB_URI: env('MONGODB_URI', 'mongodb://localhost:27017/TaiGer'),
  JWT_SECRET: env('JWT_SECRET', 'topsecret'),
  JWT_EXPIRE: env('JWT_EXPIRE', '1hr'),
  PROGRAMS_CACHE: env('PROGRAMS_CACHE', false),
  SMTP_HOST: env('SMTP_HOST', 'smtp.ethereal.email'),
  SMTP_PORT: env('SMTP_PORT', 587),
  SMTP_USERNAME: env('SMTP_USERNAME', 'glen.simonis12@ethereal.email'),
  SMTP_PASSWORD: env('SMTP_PASSWORD', 'PASSWORD'),
  UPLOAD_PATH: env('UPLOAD_PATH'),
  CLEAN_UP_SCHEDULE: env('CLEAN_UP_SCHEDULE', '* * * 1 * *'),
  WEEKLY_TASKS_REMINDER_SCHEDULE: env(
    'WEEKLY_TASKS_REMINDER_SCHEDULE',
    '0 5 0 * * 5'
  ),
  DAILY_TASKS_REMINDER_SCHEDULE: env(
    'DAILY_TASKS_REMINDER_SCHEDULE',
    '0 5 0 * * *'
  ),
  COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE: env(
    'COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE',
    '2 5 3 * 6 5'
  ),
  COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE: env(
    'COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE',
    '2 5 3 * 7 5'
  ),
  COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE: env(
    'COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE',
    '2 5 3 * 11 5'
  ),
  COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE: env(
    'COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE',
    '2 5 3 * 12 5'
  ),
  AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE: env(
    'AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE',
    '0 0 23 * * *'
  ),
  ESCALATION_DEADLINE_DAYS_TRIGGER: env('ESCALATION_DEADLINE_DAYS_TRIGGER', 30),
  AWS_S3_PUBLIC_BUCKET: env('AWS_S3_PUBLIC_BUCKET'),
  AWS_REGION: env('AWS_REGION', ''),
  AWS_S3_ACCESS_KEY_ID: env('AWS_S3_ACCESS_KEY_ID', ''),
  AWS_S3_ACCESS_KEY: env('AWS_S3_ACCESS_KEY', ''),
  AWS_S3_PUBLIC_BUCKET_NAME: env('AWS_S3_PUBLIC_BUCKET_NAME', ''),
  AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT: env(
    'AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT',
    ''
  ),
  AWS_S3_BUCKET_NAME: env('AWS_S3_BUCKET_NAME', ''),
  AWS_LOG_GROUP: env('AWS_LOG_GROUP', 'taiger-portal-dev'),
  OPENAI_API_KEY: env('OPENAI_API_KEY', '')
};
