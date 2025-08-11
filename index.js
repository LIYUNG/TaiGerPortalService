const schedule = require('node-schedule');
const https = require('https');
const fs = require('fs');

const { app } = require('./app');
const {
  PORT,
  isProd,
  isDev,
  HTTPS_KEY,
  HTTPS_CERT,
  HTTPS_CA,
  CLEAN_UP_SCHEDULE,
  WEEKLY_TASKS_REMINDER_SCHEDULE,
  DAILY_TASKS_REMINDER_SCHEDULE,
  AWS_S3_PUBLIC_BUCKET_NAME,
  AWS_S3_BUCKET_NAME,
  MONGODB_URI,
  COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE,
  COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE,
  COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE,
  COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE,
  AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE
} = require('./config');
const logger = require('./services/logger');
// const {
//   DocumentationS3GarbageCollector
// } = require('./controllers/documentations');

const {
  TasksReminderEmails,
  UrgentTasksReminderEmails,
  NextSemesterCourseSelectionReminderEmails,
  // UpdateStatisticsData,
  MeetingDailyReminderChecker,
  UnconfirmedMeetingDailyReminderChecker,
  DailyCalculateAverageResponseTime,
  NoInterviewTrainerOrTrainingDateDailyReminderChecker,
  DailyInterviewSurveyChecker
} = require('./utils/utils_function');
// const { UserS3GarbageCollector } = require('./controllers/users');

// process.on('SIGINT', () => {
//   disconnectFromDatabase(() => {
//     logger.error('Database disconnected through app termination');
//     process.exit(0);
//   });
// });

const launch = async () => {
  logger.info(`AWS_S3_BUCKET_NAME: ${process.env.AWS_S3_BUCKET_NAME}`);
  if (isDev()) {
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
  const job7 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );
  const job8 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );
  const job9 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );
  const job10 = schedule.scheduleJob(
    COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE,
    NextSemesterCourseSelectionReminderEmails
  );

  // const job11 = schedule.scheduleJob(
  //   DAILY_TASKS_REMINDER_SCHEDULE,
  //   UpdateStatisticsData
  // );
  const job12 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    MeetingDailyReminderChecker
  );

  const job13 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    UnconfirmedMeetingDailyReminderChecker
  );

  const job14 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    NoInterviewTrainerOrTrainingDateDailyReminderChecker
  );

  const job15 = schedule.scheduleJob(
    AVERAGE_RESPONSE_TIME_CALCULATION_SCHEDULE,
    DailyCalculateAverageResponseTime
  );

  const job16 = schedule.scheduleJob(
    DAILY_TASKS_REMINDER_SCHEDULE,
    DailyInterviewSurveyChecker
  );

  logger.info(`isProd : ${isProd()}`);
  logger.info(`isDev : ${isDev()}`);
  let httpsOption;
  if (isProd()) {
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
