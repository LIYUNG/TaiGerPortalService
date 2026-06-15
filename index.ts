import schedule from 'node-schedule';
import https from 'https';
import fs from 'fs';
import mongoose from 'mongoose';

import { app } from './app';
import { mongoDb } from './database';
// Compile all models on the default Mongoose connection (used by the DAO layer).
import './models';
import {
  PORT,
  isProd,
  HTTPS_KEY,
  HTTPS_CERT,
  HTTPS_CA,
  CLEAN_UP_SCHEDULE,
  WEEKLY_TASKS_REMINDER_SCHEDULE,
  DAILY_TASKS_REMINDER_SCHEDULE,
  AWS_S3_PUBLIC_BUCKET_NAME,
  AWS_S3_BUCKET_NAME,
  MONGODB_URI,
  TENANT_ID,
  COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE,
  COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE,
  COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE,
  COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE,
  AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE,
  isLocal,
  isInPipeline
} from './config';
import logger from './services/logger';
// const {
//   DocumentationS3GarbageCollector
// } = require('./controllers/documentations');

import {
  NextSemesterCourseSelectionReminderEmails,
  // UpdateStatisticsData,
  MeetingDailyReminderChecker,
  UnconfirmedMeetingDailyReminderChecker,
  DailyCalculateAverageResponseTime,
  NoInterviewTrainerOrTrainingDateDailyReminderChecker,
  DailyInterviewSurveyChecker
} from './utils/utils_function';
// const { UserS3GarbageCollector } = require('./controllers/users');

// process.on('SIGINT', () => {
//   disconnectFromDatabase(() => {
//     logger.error('Database disconnected through app termination');
//     process.exit(0);
//   });
// });

// Safety net: log (don't crash on) unhandled promise rejections. Node 15+
// terminates the process by default, so a single failed fire-and-forget side
// effect (e.g. a notification email) could take the server down. Individual
// fire-and-forget calls should still use `fireAndForget()` for context; this is
// the last line of defence.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
});

const launch = async () => {
  logger.info(`AWS_S3_BUCKET_NAME: ${process.env.AWS_S3_BUCKET_NAME}`);

  // Open the single default Mongoose connection used by the DAO layer
  // (Model.find() etc.). Without this, default-connection queries buffer and
  // time out. The whole request path now runs on this connection through the
  // service/DAO layer.
  try {
    await mongoose.connect(mongoDb(TENANT_ID));
    logger.info('MongoDB default connection established');
  } catch (err) {
    logger.error(`MongoDB default connection failed: ${err.message}`);
    return;
  }

  if (isLocal()) {
    if (
      AWS_S3_BUCKET_NAME.includes('production') ||
      AWS_S3_PUBLIC_BUCKET_NAME.includes('production') ||
      MONGODB_URI.includes('TaiGer_Prod')
    ) {
      logger.error('Database / S3 bucket name not consistent for Dev');
      return;
    }
  }

  // // setInterval(foo, 1000 * 100);

  //   *    *    *    *    *    *
  //   ┬    ┬    ┬    ┬    ┬    ┬
  //   │    │    │    │    │    │
  //   │    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
  //   │    │    │    │    └───── month (1 - 12)
  //   │    │    │    └────────── day of month (1 - 31)
  //   │    │    └─────────────── hour (0 - 23)
  //   │    └──────────────────── minute (0 - 59)
  //   └───────────────────────── second (0 - 59, OPTIONAL)
  //  ex:  '42 * * * *',: Execute a cron job when the minute is 42 (e.g. 19:42, 20:42, etc.).

  // every 1. of month clean up the documents screenshots, redundant attachment.
  logger.info(`Clean up period: ${CLEAN_UP_SCHEDULE}`);
  // const job = schedule.scheduleJob(
  //   CLEAN_UP_SCHEDULE,
  //   DocumentationS3GarbageCollector
  // );

  // every Friday, send tasks reminder emails to agents, editor and student
  logger.info(`Reminder period: ${WEEKLY_TASKS_REMINDER_SCHEDULE}`);
  // TODO: check if this is needed
  // const job3 = schedule.scheduleJob(
  //   WEEKLY_TASKS_REMINDER_SCHEDULE,
  //   TasksReminderEmails
  // );
  // TODO: could also manually activate the following (the following is working!)
  // logger.info(`Clean up User deprecated period: ${WEEKLY_TASKS_REMINDER_SCHEDULE}`);
  // const job4 = schedule.scheduleJob(CLEAN_UP_SCHEDULE, UserS3GarbageCollector);

  // everyday, send emergency tasks (deadline within 1 month)
  // reminder emails to agents, editor and student

  // TODO: check if this is needed
  // const job4 = schedule.scheduleJob(
  //   WEEKLY_TASKS_REMINDER_SCHEDULE,
  //   UrgentTasksReminderEmails
  // );

  // Remind Student to select next semester courses 6-7 month, 11-12 month.
  const _job7 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );
  const _job8 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );
  const _job9 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );
  const _job10 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );

  // const job11 = schedule.scheduleJob(
  //   DAILY_TASKS_REMINDER_SCHEDULE,
  //   UpdateStatisticsData
  // );
  const _job12 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    MeetingDailyReminderChecker
  );

  const _job13 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    UnconfirmedMeetingDailyReminderChecker
  );

  const _job14 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    NoInterviewTrainerOrTrainingDateDailyReminderChecker
  );

  const _job15 = schedule.scheduleJob(
    AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE,
    DailyCalculateAverageResponseTime
  );

  const _job16 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    DailyInterviewSurveyChecker
  );

  logger.info(`isProd : ${isProd()}`);
  logger.info(`isLocal : ${isLocal()}`);
  let httpsOption;
  if (isInPipeline()) {
    // launch http server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } else {
    if (
      fs.existsSync(HTTPS_KEY) &&
      fs.existsSync(HTTPS_CERT) &&
      fs.existsSync(HTTPS_CA)
    ) {
      httpsOption = {
        key: fs.readFileSync(HTTPS_KEY, 'utf8'),
        cert: fs.readFileSync(HTTPS_CERT, 'utf8'),
        ca: fs.readFileSync(HTTPS_CA, 'utf8')
      };
    } else {
      httpsOption = {};
      logger.warn(
        'HTTPS key, cert, or ca file missing. Please check the ./cert folder'
      );
      logger.info(`HTTPS_CA: ${HTTPS_CA}`);
      logger.info(`HTTPS_CERT: ${HTTPS_CERT}`);
      logger.info(`HTTPS_KEY: ${HTTPS_KEY}`);
    }

    https.createServer(httpsOption, app).listen(PORT, () => {
      logger.info(
        `API Service listening on port ${PORT} ! Go to https://localhost:${PORT}/`
      );
    });
  }
};

launch();
