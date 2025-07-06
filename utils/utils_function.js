const path = require('path');
const async = require('async');
const mammoth = require('mammoth');
const PdfParse = require('pdf-parse');
const {
  Role,
  isProgramDecided,
  is_TaiGer_Agent
} = require('@taiger-common/core');

const {
  MeetingReminderEmail,
  UnconfirmedMeetingReminderEmail,
  sendNoTrainerInterviewRequestsReminderEmail,
  InterviewTrainingReminderEmail,
  InterviewSurveyRequestEmail
} = require('../services/email');

const {
  StudentTasksReminderEmail,
  AgentTasksReminderEmail,
  EditorTasksReminderEmail,
  StudentApplicationsDeadline_Within30Days_DailyReminderEmail,
  StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail,
  EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail,
  AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail,
  AgentApplicationsDeadline_Within30Days_DailyReminderEmail,
  EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail,
  StudentCourseSelectionReminderEmail,
  AgentCourseSelectionReminderEmail
} = require('../services/regular_system_emails');
const logger = require('../services/logger');
const {
  does_editor_have_pending_tasks,
  is_deadline_within30days_needed,
  is_cv_ml_rl_reminder_needed,
  isNotArchiv,
  needUpdateCourseSelection
} = require('../constants');
const { asyncHandler } = require('../middlewares/error-handler');
const { AWS_S3_BUCKET_NAME, TENANT_ID } = require('../config');
const { connectToDatabase } = require('../middlewares/tenantMiddleware');
const { deleteS3Objects, listS3ObjectsV2 } = require('../aws/s3');
const { ErrorResponse } = require('../common/errors');
const StudentService = require('../services/students');

// Tested: redundant image is deleted
const threadS3GarbageCollector = async (
  req,
  collection,
  userFolder,
  ThreadId
) => {
  // This functino will be called when thread marked as finished.
  try {
    // TODO: could be bottleneck if number of thread increase.
    const ticket = await req.db.model(collection).findById(ThreadId);
    if (!ticket) {
      logger.error('threadS3GarbageCollector Invalid ThreadId');
      throw new ErrorResponse(404, 'Thread not found');
    }

    const deleteParams = {
      Delete: { Objects: [] }
    };

    const delete_files_Params = {
      Delete: { Objects: [] }
    };

    logger.info(
      'Trying to delete redundant images S3 of corresponding message thread'
    );
    // eslint-disable-next-line no-underscore-dangle
    const thread_id = ticket._id.toString();
    const user_id = ticket[userFolder].toString();
    const message_a = ticket.messages;
    let directory_img = path.join(user_id, thread_id, 'img');
    directory_img = directory_img.replace(/\\/g, '/');
    let directory_files = path.join(user_id, thread_id);
    directory_files = directory_files.replace(/\\/g, '/');
    const listParamsPublic = {
      bucketName: AWS_S3_BUCKET_NAME,
      Prefix: `${directory_img}/`
    };
    const listParamsPublic_files = {
      bucketName: AWS_S3_BUCKET_NAME,
      Prefix: `${directory_files}/`
    };
    const listedObjectsPublic = await listS3ObjectsV2(listParamsPublic);

    const listedObjectsPublic_files = await listS3ObjectsV2(
      listParamsPublic_files
    );

    if (listedObjectsPublic_files.Contents.length > 0) {
      listedObjectsPublic_files.Contents.forEach((Obj2) => {
        let file_found = false;
        if (message_a.length === 0) {
          delete_files_Params.Delete.Objects.push({ Key: Obj2.Key });
        }
        for (let i = 0; i < message_a.length; i += 1) {
          const file_name = Obj2.Key.split('/')[2];
          for (let k = 0; k < message_a[i].file.length; k += 1) {
            if (
              file_name === 'img' ||
              message_a[i].file[k].path.includes(file_name)
            ) {
              file_found = true;
              break;
            }
          }
          if (file_found) {
            break;
          }
        }
        if (!file_found) {
          // if until last message_a still not found, add the Key to the delete list
          delete_files_Params.Delete.Objects.push({ Key: Obj2.Key });
        }
      });
    }

    if (listedObjectsPublic.Contents.length > 0) {
      listedObjectsPublic.Contents.forEach((Obj) => {
        let file_found = false;
        if (message_a.length === 0) {
          deleteParams.Delete.Objects.push({ Key: Obj.Key });
        }
        for (let i = 0; i < message_a.length; i += 1) {
          const file_name = Obj.Key.split('/')[3];
          if (message_a[i].message.includes(file_name)) {
            file_found = true;
            break;
          }
        }
        if (!file_found) {
          // if until last message_a still not found, add the Key to the delete list
          deleteParams.Delete.Objects.push({ Key: Obj.Key });
        }
      });
    }

    if (deleteParams.Delete.Objects.length > 0) {
      await deleteS3Objects({
        bucketName: AWS_S3_BUCKET_NAME,
        objectKeys: deleteParams.Delete.Objects
      });

      logger.info('Deleted redundant images for threads.');
      logger.info(deleteParams.Delete.Objects);
    } else {
      logger.info('No images to be deleted for threads.');
    }
    // Bug TODO: this will also delete /img folder
    // (as it is listed as well, and not found in the files...)
    if (delete_files_Params.Delete.Objects.length > 0) {
      await deleteS3Objects({
        bucketName: AWS_S3_BUCKET_NAME,
        objectKeys: delete_files_Params.Delete.Objects
      });
      logger.info('Deleted redundant files for threads.');
      logger.info(delete_files_Params.Delete.Objects);
    } else {
      logger.info('No files to be deleted for threads.');
    }
  } catch (e) {
    logger.error(e);
    logger.error('Error during garbage collection.');
  }
};

const TasksReminderEmails_Editor_core = asyncHandler(async (req) => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  const editors = await req.db.model('Editor').find();

  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };

  const editorPromises = editors.map(async (editor) => {
    studentQuery.editors = editor._id;
    const editor_students = await StudentService.getStudentsWithApplications(
      req,
      studentQuery
    );

    if (
      editor_students.length > 0 &&
      does_editor_have_pending_tasks(editor_students, editor) &&
      isNotArchiv(editor)
    ) {
      await EditorTasksReminderEmail(
        {
          firstname: editor.firstname,
          lastname: editor.lastname,
          address: editor.email
        },
        { students: editor_students, editor }
      );
    }
  });

  await Promise.all(editorPromises);

  logger.info('Editor reminder email sent');
});

const TasksReminderEmails_Agent_core = asyncHandler(async (req) => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  const agents = await req.db.model('Agent').find();
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  for (let j = 0; j < agents.length; j += 1) {
    studentQuery.agents = agents[j]._id;
    const agent_students = await StudentService.getStudentsWithApplications(
      req,
      studentQuery
    );

    if (agent_students.length > 0) {
      if (isNotArchiv(agents[j])) {
        AgentTasksReminderEmail(
          {
            firstname: agents[j].firstname,
            lastname: agents[j].lastname,
            address: agents[j].email
          },
          { students: agent_students, agent: agents[j] }
        );
      }
    }
  }
  logger.info('Agent reminder email sent');
});

const TasksReminderEmails_Student_core = asyncHandler(async (req) => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  // TODO: it shows: "Technische Universität München (TUM) Computational Science and Engineering undefined"
  const students = await StudentService.getStudentsWithApplications(
    req,
    studentQuery
  );

  for (let j = 0; j < students.length; j += 1) {
    StudentTasksReminderEmail(
      {
        firstname: students[j].firstname,
        lastname: students[j].lastname,
        address: students[j].email
      },
      { student: students[j] }
    );
  }
  logger.info('Student reminder email sent');
});

// Weekly called.
const TasksReminderEmails = asyncHandler(async () => {
  const tenantId = TENANT_ID;
  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC');
  await TasksReminderEmails_Editor_core(req);
  await TasksReminderEmails_Student_core(req);
  await TasksReminderEmails_Agent_core(req);
});

const UrgentTasksReminderEmails_Student_core = asyncHandler(async (req) => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  const trigger_days = 3;
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  const students = await StudentService.getStudentsWithApplications(
    req,
    studentQuery
  );

  const deadlineReminderPromises = students.map(async (student) => {
    if (is_deadline_within30days_needed(student)) {
      logger.info(`Escalate: ${student.firstname} ${student.lastname}`);
      await StudentApplicationsDeadline_Within30Days_DailyReminderEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        { student, trigger_days }
      );
      logger.info(
        `Daily urgent emails sent to ${student.firstname} ${student.lastname}`
      );
    }

    if (is_cv_ml_rl_reminder_needed(student, student, trigger_days)) {
      logger.info(`Escalate: ${student.firstname} ${student.lastname}`);
      await StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        { student, trigger_days }
      );
      logger.info(
        `Daily2 urgent emails sent to ${student.firstname} ${student.lastname}`
      );
    }
  });

  await Promise.all(deadlineReminderPromises);
});

const UrgentTasksReminderEmails_Agent_core = asyncHandler(async (req) => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  const escalation_trigger_10days = 10;
  const escalation_trigger_3days = 3;
  const agents = await req.db.model('Agent').find();
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  const agentPromises = agents.map(async (agent) => {
    studentQuery.agents = agent._id;
    const agent_students = await StudentService.getStudentsWithApplications(
      req,
      studentQuery
    );
    if (agent_students.length > 0) {
      let cv_ml_rl_10days_flag = false;
      let cv_ml_rl_3days_flag = false;
      let deadline_within30days_flag = false;
      for (let x = 0; x < agent_students.length; x += 1) {
        deadline_within30days_flag |= is_deadline_within30days_needed(
          agent_students[x]
        );
        cv_ml_rl_10days_flag |= is_cv_ml_rl_reminder_needed(
          agent_students[x],
          agent,
          escalation_trigger_10days
        );
        cv_ml_rl_3days_flag |= is_cv_ml_rl_reminder_needed(
          agent_students[x],
          agent,
          escalation_trigger_3days
        );
      }
      const promises = [];
      if (deadline_within30days_flag && cv_ml_rl_3days_flag) {
        logger.info(`Escalate: ${agent.firstname} ${agent.lastname}`);
        promises.push(
          AgentApplicationsDeadline_Within30Days_DailyReminderEmail(
            {
              firstname: agent.firstname,
              lastname: agent.lastname,
              address: agent.email
            },
            {
              students: agent_students,
              agent,
              trigger_days: escalation_trigger_3days
            }
          ),
          AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail(
            {
              firstname: agent.firstname,
              lastname: agent.lastname,
              address: agent.email
            },
            {
              students: agent_students,
              agent,
              trigger_days: escalation_trigger_3days
            }
          )
        );
        logger.info(
          `Deadline urgent emails sent to ${agent.firstname} ${agent.lastname}`
        );
      } else if (cv_ml_rl_10days_flag) {
        promises.push(
          AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail(
            {
              firstname: agent.firstname,
              lastname: agent.lastname,
              address: agent.email
            },
            {
              students: agent_students,
              agent,
              trigger_days: escalation_trigger_10days
            }
          )
        );
      }
      await Promise.all(promises);
    }
  });

  await Promise.all(agentPromises);
});

const UrgentTasksReminderEmails_Editor_core = asyncHandler(async (req) => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  const editor_trigger_7days = 7;
  const editor_trigger_3days = 3;
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  const editors = await req.db.model('Editor').find();

  // TODO: it shows: "Technische Universität München (TUM) Computational Science and Engineering undefined"
  // (O): Check if editor no reply (need to response) more than 3 days (Should configurable)
  for (let j = 0; j < editors.length; j += 1) {
    studentQuery.editors = editors[j]._id;
    const editor_students = await StudentService.getStudentsWithApplications(
      req,
      studentQuery
    );
    if (editor_students.length > 0) {
      let cv_ml_rl_7days_flag = false;
      let cv_ml_rl_3days_flag = false;
      let deadline_within30days_flag = false;
      for (let x = 0; x < editor_students.length; x += 1) {
        deadline_within30days_flag |= is_deadline_within30days_needed(
          editor_students[x]
        );
        cv_ml_rl_7days_flag |= is_cv_ml_rl_reminder_needed(
          editor_students[x],
          editors[j],
          editor_trigger_7days
        );
        cv_ml_rl_3days_flag |= is_cv_ml_rl_reminder_needed(
          editor_students[x],
          editors[j],
          editor_trigger_3days
        );
      }

      if (deadline_within30days_flag) {
        if (cv_ml_rl_3days_flag) {
          logger.info(
            `Escalate: ${editors[j].firstname} ${editors[j].lastname}`
          );
          EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail(
            {
              firstname: editors[j].firstname,
              lastname: editors[j].lastname,
              address: editors[j].email
            },
            { students: editor_students }
          );
          logger.info(
            `Daily urgent emails sent to ${editors[j].firstname} ${editors[j].lastname}`
          );
        }
      } else if (cv_ml_rl_7days_flag) {
        logger.info(`Escalate: ${editors[j].firstname} ${editors[j].lastname}`);
        await EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail(
          {
            firstname: editors[j].firstname,
            lastname: editors[j].lastname,
            address: editors[j].email
          },
          {
            students: editor_students,
            editor: editors[j],
            trigger_days: editor_trigger_7days
          }
        );
      }
    }
  }
});

const UrgentTasksReminderEmails = asyncHandler(async () => {
  const tenantId = TENANT_ID;
  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC');
  const UrgentTaskPromises = [
    // UrgentTasksReminderEmails_Editor_core(req), // TODO: check if this is needed
    // UrgentTasksReminderEmails_Student_core(req), // TODO: check if this is needed
    // UrgentTasksReminderEmails_Agent_core(req) // TODO: check if this is needed
  ];

  await Promise.all(UrgentTaskPromises);
});

const NextSemesterCourseSelectionStudentReminderEmails = asyncHandler(
  async (req) => {
    // Only inform active student

    const studentsWithCourses = await req.db.model('Student').aggregate([
      {
        $match: {
          archiv: { $ne: true } // Filter out students where 'archiv' is not equal to true
        }
      },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'courses'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          email: 1,
          role: 1,
          archiv: 1,
          academic_background: 1,
          courses: 1
        }
      }
    ]);

    for (let j = 0; j < studentsWithCourses.length; j += 1) {
      if (isNotArchiv(studentsWithCourses[j])) {
        if (needUpdateCourseSelection(studentsWithCourses[j])) {
          // Inform student
          StudentCourseSelectionReminderEmail(
            {
              firstname: studentsWithCourses[j].firstname,
              lastname: studentsWithCourses[j].lastname,
              address: studentsWithCourses[j].email
            },
            { student: studentsWithCourses[j] }
          );
        }
      }
    }
  }
);

const NextSemesterCourseSelectionAgentReminderEmails = asyncHandler(
  async () => {
    // Only inform active student
    const tenantId = TENANT_ID;
    const req = {};
    req.db = connectToDatabase(tenantId);
    req.VCModel = req.db.model('VC');
    const studentsWithCourses = await req.db.model('Student').aggregate([
      {
        $match: {
          archiv: { $ne: true } // Filter out students where 'archiv' is not equal to true
        }
      },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'courses'
        }
      },
      {
        $lookup: {
          from: 'users', // Replace 'users' with the actual name of the User collection
          localField: 'agents',
          foreignField: '_id',
          as: 'agentsInfo'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          email: 1,
          role: 1,
          archiv: 1,
          agents: {
            $map: {
              input: '$agents',
              as: 'agentId',
              in: {
                $let: {
                  vars: {
                    agentInfo: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$agentsInfo',
                            cond: { $eq: ['$$this._id', '$$agentId'] }
                          }
                        },
                        0
                      ]
                    }
                  },
                  in: {
                    firstname: '$$agentInfo.firstname',
                    lastname: '$$agentInfo.lastname',
                    archiv: '$$agentInfo.archiv',
                    email: '$$agentInfo.email'
                  }
                }
              }
            }
          },
          academic_background: 1,
          courses: 1
        }
      }
    ]);
    for (let j = 0; j < studentsWithCourses.length; j += 1) {
      if (isNotArchiv(studentsWithCourses[j])) {
        if (needUpdateCourseSelection(studentsWithCourses[j])) {
          // TODO: move informing Agent to another function so that all students needing update in 1 email for agents.
          for (let x = 0; x < studentsWithCourses[j].agents.length; x += 1) {
            if (isNotArchiv(studentsWithCourses[j].agents[x])) {
              // TODO: inform Agent
              await AgentCourseSelectionReminderEmail(
                {
                  firstname: studentsWithCourses[j].agents[x].firstname,
                  lastname: studentsWithCourses[j].agents[x].lastname,
                  address: studentsWithCourses[j].agents[x].email
                },
                { student: studentsWithCourses[j] }
              );
            }
          }
        }
      }
    }
  }
);

const NextSemesterCourseSelectionReminderEmails = asyncHandler(async () => {
  const tenantId = TENANT_ID;

  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC');
  await NextSemesterCourseSelectionStudentReminderEmails(req);
  // await NextSemesterCourseSelectionAgentReminderEmails();
});

const numStudentYearDistribution = (students) =>
  students.reduce((acc, student) => {
    const date =
      student.application_preference.expected_application_date || 'TBD';
    acc[date] = (acc[date] || 0) + 1;
    return acc;
  }, {});

// const UpdateStatisticsData = asyncHandler(async () => {
//   const documents_cv = await Documentthread.find({
//     isFinalVersion: false,
//     file_type: 'CV'
//   }).countDocuments();
//   // TODO: this include the tasks that created by not shown, because the programs are not decided.
//   // So that is why the number is more than what we actually see in UI.
//   // Case 2: if student in Archiv, but the tasks are still open!! then the number is not correct!
//   const documents_ml = await Documentthread.find({
//     isFinalVersion: false,
//     file_type: 'ML'
//   }).countDocuments();
//   const documents_rl = await Documentthread.find({
//     isFinalVersion: false,
//     $or: [
//       { file_type: 'RL_A' },
//       { file_type: 'RL_B' },
//       { file_type: 'RL_C' },
//       { file_type: 'Recommendation_Letter_A' },
//       { file_type: 'Recommendation_Letter_B' },
//       { file_type: 'Recommendation_Letter_C' }
//     ]
//   }).countDocuments();
//   const documents_essay = await Documentthread.find({
//     isFinalVersion: false,
//     file_type: 'Essay'
//   }).countDocuments();
//   const documents_data = {};
//   documents_data.CV = { count: documents_cv };
//   documents_data.ML = { count: documents_ml };
//   documents_data.RL = { count: documents_rl };
//   documents_data.ESSAY = { count: documents_essay };
//   const agents = await Agent.find({
//     $or: [{ archiv: { $exists: false } }, { archiv: false }]
//   });
//   const editors = await Editor.find({
//     $or: [{ archiv: { $exists: false } }, { archiv: false }]
//   });
//   const students = await Student.find()
//     .populate('agents editors', 'firstname lastname')
//     .populate('')
//     .populate(
//       'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
//       '-messages'
//     );
//   const agents_data = [];
//   const editors_data = [];
//   for (let i = 0; i < agents.length; i += 1) {
//     const Obj = {};
//     Obj._id = agents[i]._id.toString();
//     Obj.firstname = agents[i].firstname;
//     Obj.lastname = agents[i].lastname;
//     Obj.student_num = await Student.find({
//       agents: agents[i]._id,
//       $or: [{ archiv: { $exists: false } }, { archiv: false }]
//     }).countDocuments();
//     agents_data.push(Obj);
//   }
//   for (let i = 0; i < editors.length; i += 1) {
//     const Obj = {};
//     Obj._id = editors[i]._id.toString();
//     Obj.firstname = editors[i].firstname;
//     Obj.lastname = editors[i].lastname;
//     Obj.student_num = await Student.find({
//       editors: editors[i]._id,
//       $or: [{ archiv: { $exists: false } }, { archiv: false }]
//     }).countDocuments();
//     editors_data.push(Obj);
//   }
//   const finished_docs = await Documentthread.find({
//     isFinalVersion: true,
//     $or: [
//       { file_type: 'CV' },
//       { file_type: 'ML' },
//       { file_type: 'RL_A' },
//       { file_type: 'RL_B' },
//       { file_type: 'RL_C' },
//       { file_type: 'Recommendation_Letter_A' },
//       { file_type: 'Recommendation_Letter_B' },
//       { file_type: 'Recommendation_Letter_C' }
//     ]
//   })
//     .populate('student_id', 'firstname lastname')
//     .select('file_type messages.createdAt');
//   const users = await User.find({
//     role: { $in: ['Admin', 'Agent', 'Editor'] }
//   }).lean();
//   const result = {
//     success: true,
//     data: users,
//     // documents_all_open,
//     documents: documents_data,
//     students: {
//       isClose: students.filter((student) => student.archiv === true).length,
//       isOpen: students.filter((student) => student.archiv !== true).length
//     },
//     finished_docs,
//     agents: agents_data,
//     editors: editors_data,
//     students_details: students,
//     applications: []
//   };
// });

const add_portals_registered_status = (applications) => {
  const new_applications = [];
  for (let i = 0; i < applications.length; i += 1) {
    const application = applications[i];
    if (isProgramDecided(application)) {
      if (application.programId.application_portal_a) {
        if (
          application.portal_credentials &&
          application.portal_credentials.application_portal_a &&
          application.portal_credentials.application_portal_a.account &&
          application.portal_credentials.application_portal_a.password
        ) {
          application.credential_a_filled = true;
        } else {
          application.credential_a_filled = false;
        }
      } else {
        application.credential_a_filled = true;
      }
      if (application.programId.application_portal_b) {
        if (
          application.portal_credentials &&
          application.portal_credentials.application_portal_b &&
          application.portal_credentials.application_portal_b.account &&
          application.portal_credentials.application_portal_b.password
        ) {
          application.credential_b_filled = true;
        } else {
          application.credential_b_filled = false;
        }
      } else {
        application.credential_b_filled = true;
      }
    } else {
      application.credential_a_filled = true;
      application.credential_b_filled = true;
    }

    delete application.portal_credentials;
    new_applications.push(application);
  }
  return new_applications;
};

const MeetingDailyReminderChecker = asyncHandler(async () => {
  const currentDate = new Date();
  const twentyFourHoursLater = new Date(currentDate);
  twentyFourHoursLater.setHours(currentDate.getHours() + 24);

  const tenantId = TENANT_ID;
  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC'); // Only future meeting within 24 hours, not past
  const upcomingEvents = await req.db
    .model('Event')
    .find({
      $and: [
        {
          end: {
            $gte: currentDate,
            $lt: twentyFourHoursLater
          }
        },
        { isConfirmedReceiver: true },
        { isConfirmedRequester: true }
      ]
    })
    .populate('requester_id receiver_id', 'firstname lastname email');
  if (upcomingEvents) {
    for (let j = 0; j < upcomingEvents.length; j += 1) {
      if (upcomingEvents.event_type === 'Interview') {
        // eslint-disable-next-line no-await-in-loop
        await InterviewTrainingReminderEmail(
          {
            firstname: upcomingEvents[j].requester_id[0].firstname,
            lastname: upcomingEvents[j].requester_id[0].lastname,
            address: upcomingEvents[j].requester_id[0].email
          },
          {
            event: upcomingEvents[j]
          }
        );
        await InterviewTrainingReminderEmail(
          {
            firstname: upcomingEvents[j].receiver_id[0].firstname,
            lastname: upcomingEvents[j].receiver_id[0].lastname,
            address: upcomingEvents[j].receiver_id[0].email
          },
          {
            event: upcomingEvents[j]
          }
        );
      } else {
        // eslint-disable-next-line no-await-in-loop
        await MeetingReminderEmail(
          {
            firstname: upcomingEvents[j].requester_id[0].firstname,
            lastname: upcomingEvents[j].requester_id[0].lastname,
            address: upcomingEvents[j].requester_id[0].email
          },
          {
            event: upcomingEvents[j]
          }
        );
        await MeetingReminderEmail(
          {
            firstname: upcomingEvents[j].receiver_id[0].firstname,
            lastname: upcomingEvents[j].receiver_id[0].lastname,
            address: upcomingEvents[j].receiver_id[0].email
          },
          {
            event: upcomingEvents[j]
          }
        );
      }
    }
    logger.info('Meeting attendees reminded');
  }
});

// every day reminder
const UnconfirmedMeetingDailyReminderChecker = asyncHandler(async () => {
  const currentDate = new Date();

  // Only future meeting within 24 hours, not past
  const tenantId = TENANT_ID;
  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC');
  const upcomingEvents = await req.db
    .model('Event')
    .find({
      $and: [
        {
          end: {
            $gte: currentDate
          }
        },
        {
          $or: [{ isConfirmedReceiver: false }, { isConfirmedRequester: false }]
        }
      ]
    })
    .populate('requester_id receiver_id', 'firstname lastname role email');
  if (upcomingEvents) {
    for (let j = 0; j < upcomingEvents.length; j += 1) {
      if (!upcomingEvents[j].isConfirmedRequester) {
        UnconfirmedMeetingReminderEmail(
          {
            firstname: upcomingEvents[j].requester_id[0].firstname,
            lastname: upcomingEvents[j].requester_id[0].lastname,
            address: upcomingEvents[j].requester_id[0].email
          },
          {
            event: upcomingEvents[j],
            firstname: upcomingEvents[j].receiver_id[0].firstname,
            lastname: upcomingEvents[j].receiver_id[0].lastname,
            id: upcomingEvents[j].requester_id[0]._id.toString(),
            role: upcomingEvents[j].requester_id[0].role
          }
        );
      }
      if (!upcomingEvents[j].isConfirmedReceiver) {
        UnconfirmedMeetingReminderEmail(
          {
            firstname: upcomingEvents[j].receiver_id[0].firstname,
            lastname: upcomingEvents[j].receiver_id[0].lastname,
            address: upcomingEvents[j].receiver_id[0].email
          },
          {
            event: upcomingEvents[j],
            firstname: upcomingEvents[j].requester_id[0].firstname,
            lastname: upcomingEvents[j].requester_id[0].lastname,
            id: upcomingEvents[j].receiver_id[0]._id.toString(),
            role: upcomingEvents[j].receiver_id[0].role
          }
        );
      }
    }
  }

  logger.info('Unconfirmed Meeting attendee reminded');
});

function CalculateInterval(message1, message2) {
  const intervalInDay =
    Math.abs(message1.createdAt - message2.createdAt) / (1000 * 60 * 60 * 24);
  return parseFloat(intervalInDay.toFixed(4));
}

const GroupCommunicationByStudent = asyncHandler(async (req) => {
  try {
    const communications = await req.db
      .model('Communication')
      .find()
      .populate('student_id user_id', 'firstname lastname email archiv')
      .lean();
    const groupCommunication = communications.reduce((acc, communication) => {
      const student = communication.student_id;

      if (student && !student.archiv) {
        const studentId = student._id.toString();

        if (!acc[studentId]) {
          acc[studentId] = [communication];
        } else {
          acc[studentId].push(communication);
        }
      }

      return acc;
    }, {});
    return groupCommunication;
  } catch (error) {
    logger.error('error grouping communications');
    return null;
  }
});

const CreateIntervalMessageOperation = (student_id, msg1, msg2) => {
  const intervalValue = CalculateInterval(msg1, msg2);
  const intervalData = {
    student_id,
    message_1_id: msg1._id,
    message_2_id: msg2._id,
    interval_type: 'communication',
    interval: intervalValue,
    intervalStartAt: msg1.createdAt,
    updatedAt: new Date()
  };

  // Create a query object excluding the updatedAt field
  const { updatedAt, ...queryData } = intervalData;

  // Define the update operation
  const update = {
    $setOnInsert: intervalData
  };

  return {
    updateOne: {
      filter: queryData,
      update,
      upsert: true
    }
  };
};
/**
 * Process messages to calculate response intervals based on the following cases:
 *
 * Case 1: Single Student Message
 * =============================
 * Input: [StudentMsg1]
 * Interval: now - StudentMsg1.updatedAt
 * Purpose: Calculate how long the student has been waiting for a response
 *
 * Case 2: Multiple Messages
 * ========================
 * Input: [StudentMsg1 -> StudentMsg2 -> NonStudentMsg1 -> NonStudentMsg2]
 * Interval: NonStudentMsg1.updatedAt - StudentMsg2.updatedAt
 * Purpose: Calculate response time from last student message to first staff response
 *
 * Case 3: Ignored Student Message
 * ==============================
 * Input: [StudentMsg(ignored=true) -> NonStudentMsg]
 * Interval: No calculation
 * Purpose: Skip messages marked as ignored
 *
 * Case 4: Latest Message from Student
 * =================================
 * Input: [...previousMessages -> StudentMsg]
 * Interval: now - StudentMsg.updatedAt
 * Purpose: Calculate current waiting time for pending student message
 *
 * General Rules:
 * - Intervals only calculated from student message to non-student message
 * - Student messages with ignore_message=true are skipped
 * - Messages are processed in chronological order
 * - Only first non-student response is used for interval calculation
 */
const ProcessMessages = (student, messages) => {
  const bulkOps = [];
  const now = new Date();

  // If no messages, return empty array
  if (!messages.length) return bulkOps;

  // Sort messages chronologically
  messages.sort((a, b) => a.updatedAt - b.updatedAt);

  let lastValidStudentMsg = undefined;

  for (let i = 0; i < messages.length; i++) {
    const currentMsg = messages[i];
    const UserRole = currentMsg.user_id?.role;

    // Handle student messages
    if (UserRole === Role.Student) {
      // Skip ignored messages
      if (currentMsg.ignore_message === true) {
        continue;
      }
      lastValidStudentMsg = currentMsg;

      // Case 1 & 4: If this is the only message or the last message
      if (i === messages.length - 1) {
        const operation = CreateIntervalMessageOperation(
          student,
          lastValidStudentMsg,
          { updatedAt: now } // Create pseudo message with current time
        );
        if (operation) {
          bulkOps.push(operation);
        }
      }
      continue;
    }

    // Handle non-student messages
    if (UserRole !== Role.Student && lastValidStudentMsg) {
      // Case 2: Found a non-student message after a valid student message
      const operation = CreateIntervalMessageOperation(
        student,
        lastValidStudentMsg,
        currentMsg
      );
      if (operation) {
        bulkOps.push(operation);
      }
      lastValidStudentMsg = undefined; // Reset for next pair
    }
  }

  return bulkOps;
};

const ProcessThread = (thread) => {
  const bulkOps = [];
  const now = new Date();

  // If no messages in thread, return empty array
  if (!thread.messages?.length) return bulkOps;

  // Sort messages chronologically
  thread.messages.sort((a, b) => a.updatedAt - b.updatedAt);

  let lastValidStudentMsg = undefined;

  for (let i = 0; i < thread.messages.length; i++) {
    try {
      const currentMsg = thread.messages[i];
      const UserRole = currentMsg.user_id?.role;

      // Handle student messages
      if (UserRole === Role.Student) {
        // Skip ignored messages
        if (currentMsg.ignore_message === true) {
          continue;
        }
        lastValidStudentMsg = currentMsg;

        // Case 1 & 4: If this is the only message or the last message
        if (i === thread.messages.length - 1) {
          const operation = CreateIntervalOperation(
            thread,
            lastValidStudentMsg,
            { updatedAt: now } // Create pseudo message with current time
          );
          if (operation) {
            bulkOps.push(operation);
          }
        }
        continue;
      }

      // Handle non-student messages
      if (UserRole !== Role.Student && lastValidStudentMsg) {
        // Case 2: Found a non-student message after a valid student message
        const operation = CreateIntervalOperation(
          thread,
          lastValidStudentMsg,
          currentMsg
        );
        if (operation) {
          bulkOps.push(operation);
        }
        lastValidStudentMsg = undefined; // Reset for next pair
      }
    } catch (error) {
      logger.error('Error processing message:', error);
    }
  }

  return bulkOps;
};

const FindIntervalInCommunicationsAndSave = asyncHandler(async (req) => {
  try {
    // TODO: active student's message only (should already done, please check GroupCommunicationByStudent)
    const groupCommunication = await GroupCommunicationByStudent(req);
    const bulkOps = [];

    for (const [student, messages] of Object.entries(groupCommunication)) {
      const studentBulkOps = ProcessMessages(student, messages);
      bulkOps.push(...studentBulkOps);
    }

    if (bulkOps.length > 0) {
      const result = await req.db.model('Interval').bulkWrite(bulkOps);
      logger.info(
        'FindIntervalInCommunicationsAndSave: Bulk operation result:',
        result
      );
    }
  } catch (error) {
    logger.error('Error finding valid interval:', error);
  }
});

const CreateIntervalOperation = (thread, msg1, msg2) => {
  const intervalValue = CalculateInterval(msg1, msg2);
  const intervalData = {
    thread_id: thread._id,
    message_1_id: msg1._id,
    message_2_id: msg2._id,
    interval_type: thread.file_type,
    interval: intervalValue,
    intervalStartAt: msg1.createdAt,
    updatedAt: new Date()
  };

  // Create a query object excluding the updatedAt field
  const { updatedAt, ...queryData } = intervalData;

  // Define the update operation
  const update = {
    $setOnInsert: intervalData
  };

  return {
    updateOne: {
      filter: queryData,
      update: update,
      upsert: true
    }
  };
};

const FetchStudentsForDocumentThreads = asyncHandler(async (req, filter) =>
  req.db
    .model('Student')
    .find(filter)
    .populate('agents editors', 'firstname lastname email')
    .populate({
      path: 'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
      populate: {
        path: 'messages',
        populate: {
          path: 'user_id',
          model: 'User'
        }
      }
    })
    .lean()
);

const FindIntervalInDocumentThreadAndSave = asyncHandler(async (req) => {
  try {
    // calculate active student only
    const students = await FetchStudentsForDocumentThreads(req, {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    const bulkOps = [];

    for (const student of students) {
      try {
        for (const generaldocs_thread of student.generaldocs_threads) {
          const thread = generaldocs_thread.doc_thread_id;
          const threadBulkOps = ProcessThread(thread);
          bulkOps.push(...threadBulkOps);
        }
      } catch (e) {
        logger.error('Error retrieving general docs', e);
      }

      try {
        for (const application of student.applications) {
          for (const doc_thread_id of application.doc_modification_thread) {
            const thread = doc_thread_id.doc_thread_id;
            const threadBulkOps = ProcessThread(thread);
            bulkOps.push(...threadBulkOps);
          }
        }
      } catch (e) {
        logger.error('Error retrieving application docs', e);
      }
    }

    if (bulkOps.length > 0) {
      const result = await req.db.model('Interval').bulkWrite(bulkOps);
      logger.info(
        'FindIntervalInDocumentThreadAndSave: Bulk operation result:',
        result
      );
    }
  } catch (error) {
    logger.error('Error in FindIntervalInDocumentThreadAndSave:', error);
  }
});

const GroupIntervals = asyncHandler(async (req) => {
  try {
    const intervals = await req.db
      .model('Interval')
      .find()
      .populate('thread_id student_id')
      .lean();
    const studentGroupInterval = {};
    const documentThreadGroupInterval = {};
    intervals.forEach((singleInterval) => {
      const { student_id, thread_id } = singleInterval;
      const key = student_id
        ? student_id._id.toString()
        : thread_id._id.toString();
      const group = student_id
        ? studentGroupInterval
        : documentThreadGroupInterval;
      if (!group[key]) {
        group[key] = [singleInterval];
      } else {
        group[key].push(singleInterval);
      }
    });
    return [studentGroupInterval, documentThreadGroupInterval];
  } catch (error) {
    logger.error('Error grouping communications:', error);
    return null;
  }
});

const patternMatched = async (fileBuffer, extension, patterns) => {
  const lowerCasePatterns = patterns.map((pattern) => pattern.toLowerCase());
  const extractText = async () => {
    let data = null;
    if (extension === 'pdf') {
      const result = await PdfParse(fileBuffer);
      data = result.text.toLowerCase();
    } else if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      data = result.value.toLowerCase();
    }

    return data;
  };

  const text = await extractText();
  if (!text) return false; // Early return if text extraction failed

  return lowerCasePatterns.some((pattern) => text.includes(pattern));
};

const CalculateAverageResponseTimeAndSave = asyncHandler(async (req) => {
  const [studentGroupInterval, documentThreadGroupInterval] =
    await GroupIntervals(req);
  const calculateAndSaveAverage = async (groupInterval, idKey) => {
    try {
      const bulkOps = [];

      // Prepare the bulk operations
      for (const key in groupInterval) {
        const intervals = groupInterval[key];
        const total = intervals.reduce(
          (sum, interval) => sum + interval.interval,
          0
        );
        const final_avg = (total / intervals.length).toFixed(2);

        const singleInterval = intervals[0];
        const intervalType = singleInterval.interval_type;

        const query = {
          [`${idKey}`]: key.toString(),
          interval_type: intervalType
        };
        let update;
        if (idKey === 'thread_id') {
          update = {
            $set: {
              intervalAvg: final_avg,
              updatedAt: new Date()
            },
            $setOnInsert: {
              student_id: singleInterval.thread_id.student_id?.toString(),
              [`${idKey}`]: key.toString(),
              interval_type: intervalType
            }
          };
        } else {
          update = {
            $set: {
              intervalAvg: final_avg,
              updatedAt: new Date()
            },
            $setOnInsert: {
              [`${idKey}`]: key.toString(),
              interval_type: intervalType
            }
          };
        }

        bulkOps.push({
          updateOne: {
            filter: query,
            update,
            upsert: true
          }
        });
      }

      // Execute bulk operations
      if (bulkOps.length > 0) {
        const result = await req.db.model('ResponseTime').bulkWrite(bulkOps);
        logger.info('calculateAndSaveAverage: Bulk operation result:', result);
      }
    } catch (err) {
      logger.error(
        `Error calculating and saving average response time for ${idKey}:`,
        err
      );
    }
  };

  await calculateAndSaveAverage(studentGroupInterval, 'student_id');
  await calculateAndSaveAverage(documentThreadGroupInterval, 'thread_id');
});

const DailyCalculateAverageResponseTime = asyncHandler(async () => {
  const tenantId = TENANT_ID;
  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC');
  await FindIntervalInCommunicationsAndSave(req);
  await FindIntervalInDocumentThreadAndSave(req);
  await CalculateAverageResponseTimeAndSave(req);
});

const DailyInterviewSurveyChecker = asyncHandler(async () => {
  // TODO: find today meeting and send email reminder (only once)
  const currentDate = new Date();
  const twentyFourHoursAgo = new Date(currentDate);
  twentyFourHoursAgo.setHours(currentDate.getHours() - 24);
  // interviews took place within last 24 hours
  const tenantId = TENANT_ID;
  const req = {};
  req.db = connectToDatabase(tenantId);
  req.VCModel = req.db.model('VC');
  const interviewTookPlacedToday = await req.db
    .model('Interview')
    .find({
      interview_date: {
        $gte: twentyFourHoursAgo.toISOString(),
        $lt: currentDate
      }
    })
    .populate('student_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .lean();

  // send interview survey request email
  interviewTookPlacedToday?.map((interview) =>
    InterviewSurveyRequestEmail(
      {
        firstname: interview.student_id.firstname,
        lastname: interview.student_id.lastname,
        address: interview.student_id.email
      },
      { interview }
    )
  );
});

// every day reminder
// TODO: (O)no trainer, no date.
const NoInterviewTrainerOrTrainingDateDailyReminderChecker = asyncHandler(
  async () => {
    const currentDate = new Date();
    const currentDateString = currentDate.toISOString().split('T')[0]; // Converts to 'YYYY-MM-DD' format

    const tenantId = TENANT_ID;
    const req = {};
    req.db = connectToDatabase(tenantId);
    req.VCModel = req.db.model('VC');
    // Only future meeting within 24 hours, not past
    const interviewRequests = await req.db
      .model('Interview')
      .find({
        $and: [
          {
            interview_date: {
              $gte: currentDateString
            }
          },
          {
            $or: [
              {
                trainer_id: {
                  $exists: false
                }
              },
              {
                trainer_id: {
                  $size: 0
                }
              }
            ]
          }
        ]
      })
      .populate('student_id', 'firstname lastname role email')
      .populate('program_id');

    // TODO: reminder agent as well

    if (interviewRequests?.length > 0) {
      const permissions = await req.db
        .model('Permission')
        .find({
          canAssignEditors: true
        })
        .populate('user_id', 'firstname lastname email')
        .lean();
      const sendEmailPromises = permissions.map((permission) =>
        sendNoTrainerInterviewRequestsReminderEmail(
          {
            firstname: permission.user_id.firstname,
            lastname: permission.user_id.lastname,
            address: permission.user_id.email
          },
          {
            interviewRequests
          }
        )
      );
      await Promise.all(sendEmailPromises);
      logger.info('No interviewer tasks reminder sent.');
    }
  }
);

const userChangesHelperFunction = async (req, newUserIds, existingUsers) => {
  const newUserIdsArr = Object.keys(newUserIds);
  const updatedUserIds = newUserIdsArr.filter(
    (editorId) => newUserIds[editorId]
  );

  // Fetch editors concurrently
  const users = await Promise.all(
    updatedUserIds.map((id) =>
      req.db
        .model('User')
        .findById(id)
        .select('firstname lastname email archiv')
        .lean()
    )
  );

  // Prepare data for updating
  const beforeChangeUsersArr = existingUsers || [];

  // Create sets for easy comparison
  const previousEditorSet = new Set(
    beforeChangeUsersArr.map((usr) => usr._id.toString())
  );
  const newEditorSet = new Set(updatedUserIds);

  // Find newly added and removed editors
  const addedUsers = users.filter(
    (usr) => !previousEditorSet.has(usr._id.toString())
  );
  const removedUsers = beforeChangeUsersArr.filter(
    (usr) => !newEditorSet.has(usr._id.toString())
  );

  const toBeInformedUsers = [];
  const updatedUsers = [];

  users.forEach((usr) => {
    if (usr) {
      updatedUsers.push({
        firstname: usr.firstname,
        lastname: usr.lastname,
        email: usr.email
      });
      if (
        !beforeChangeUsersArr
          ?.map((user) => user._id.toString())
          .includes(usr._id.toString())
      ) {
        toBeInformedUsers.push({
          firstname: usr.firstname,
          lastname: usr.lastname,
          archiv: usr.archiv,
          email: usr.email
        });
      }
    }
  });

  return {
    addedUsers,
    removedUsers,
    updatedUsers,
    toBeInformedUsers,
    updatedUserIds
  };
};

module.exports = {
  threadS3GarbageCollector,
  TasksReminderEmails,
  UrgentTasksReminderEmails,
  NextSemesterCourseSelectionReminderEmails,
  numStudentYearDistribution,
  // UpdateStatisticsData,
  add_portals_registered_status,
  MeetingDailyReminderChecker,
  UnconfirmedMeetingDailyReminderChecker,
  DailyCalculateAverageResponseTime,
  DailyInterviewSurveyChecker,
  patternMatched,
  NoInterviewTrainerOrTrainingDateDailyReminderChecker,
  userChangesHelperFunction
};
