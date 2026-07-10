import path from 'path';
import mammoth from 'mammoth';
import PdfParse from 'pdf-parse';
import type { Request } from 'express';
import type { ObjectIdentifier } from '@aws-sdk/client-s3';
import type { AnyBulkWriteOperation, FilterQuery } from 'mongoose';
import type {
  IApplication,
  IInterval,
  IProgram,
  IResponseTime,
  IStudent
} from '@taiger-common/model';
import { Role, isProgramDecided } from '@taiger-common/core';

import {
  MeetingReminderEmail,
  UnconfirmedMeetingReminderEmail,
  sendNoTrainerInterviewRequestsReminderEmail,
  InterviewTrainingReminderEmail,
  InterviewSurveyRequestEmail
} from '../services/email';

// `regular_system_emails` uses `export =`, which cannot be destructured with a
// named ES import (TS2497) even with esModuleInterop — only a default-style
// import works, so we bind the whole module and access members off it below.
import RegularSystemEmails from '../services/regular_system_emails';
import logger from '../services/logger';
import {
  does_editor_have_pending_tasks,
  is_deadline_within30days_needed,
  is_cv_ml_rl_reminder_needed,
  isNotArchiv,
  needUpdateCourseSelection
} from '../constants';
import { asyncHandler } from '../middlewares/error-handler';
import { AWS_S3_BUCKET_NAME } from '../config';
import { deleteS3Objects, listS3ObjectsV2 } from '../aws/s3';
import { ErrorResponse } from '../common/errors';
import StudentService from '../services/students';
import UserService from '../services/users';
import EventService from '../services/events';
import InterviewService from '../services/interviews';
import PermissionService from '../services/permissions';
import CommunicationService from '../services/communications';
import IntervalService from '../services/intervals';
import ResponseTimeService from '../services/responseTimes';
import DocumentThreadService from '../services/documentthreads';
import ComplaintService from '../services/complaints';

const {
  StudentTasksReminderEmail,
  EditorTasksReminderEmail,
  StudentApplicationsDeadline_Within30Days_DailyReminderEmail,
  StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail,
  EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail,
  AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail,
  AgentApplicationsDeadline_Within30Days_DailyReminderEmail,
  EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail,
  StudentCourseSelectionReminderEmail,
  AgentCourseSelectionReminderEmail
} = RegularSystemEmails;

// Derived (not exported by `constants.ts`) argument types for the helpers
// below, so student/user documents can be passed without re-declaring their
// "populated aggregate result" shapes here.
type PendingTasksStudents = Parameters<
  typeof does_editor_have_pending_tasks
>[0];
type PendingTasksUser = Parameters<typeof does_editor_have_pending_tasks>[1];

// Tested: redundant image is deleted
export const threadS3GarbageCollector = async (
  req: Request,
  collection: string,
  userFolder: string,
  ThreadId: string
) => {
  // This functino will be called when thread marked as finished.
  try {
    // TODO: could be bottleneck if number of thread increase.
    const ticket =
      collection === 'Complaint'
        ? await ComplaintService.getComplaintDocById(ThreadId)
        : await DocumentThreadService.getThreadDocById(ThreadId);
    if (!ticket) {
      logger.error('threadS3GarbageCollector Invalid ThreadId');
      throw new ErrorResponse(404, 'Thread not found');
    }

    const deleteParams: { Delete: { Objects: ObjectIdentifier[] } } = {
      Delete: { Objects: [] }
    };

    const delete_files_Params: { Delete: { Objects: ObjectIdentifier[] } } = {
      Delete: { Objects: [] }
    };

    logger.info(
      'Trying to delete redundant images S3 of corresponding message thread'
    );
    // `ticket` is either a Complaint or Documentthread hydrated document —
    // both have `_id`, and are keyed dynamically by `userFolder` (e.g.
    // `requester_id`/`student_id`) and carry a `messages` array of the same
    // shared shape ({ message, file: [{ path }] }).
    // eslint-disable-next-line no-underscore-dangle
    const thread_id = ticket._id.toString();
    const dynamicTicket = ticket as unknown as Record<
      string,
      { toString(): string }
    >;
    const user_id = dynamicTicket[userFolder].toString();
    const message_a = ticket.messages as Array<{
      message?: string;
      file?: Array<{ path?: string }>;
    }>;

    logger.info('Garbage collection context:', {
      threadId: thread_id,
      userId: user_id,
      messageCount: message_a?.length || 0,
      collection,
      userFolder
    });
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
    let listedObjectsPublicResult: Awaited<ReturnType<typeof listS3ObjectsV2>>;
    let listedObjectsPublicFilesResult: Awaited<
      ReturnType<typeof listS3ObjectsV2>
    >;

    try {
      listedObjectsPublicResult = await listS3ObjectsV2(listParamsPublic);
      listedObjectsPublicFilesResult = await listS3ObjectsV2(
        listParamsPublic_files
      );
    } catch (s3Error) {
      logger.error('Failed to list S3 objects:', {
        error: s3Error instanceof Error ? s3Error.message : String(s3Error),
        stack: s3Error instanceof Error ? s3Error.stack : undefined,
        listParamsPublic,
        listParamsPublic_files
      });
      throw s3Error;
    }

    // `listS3ObjectsV2` can only resolve to `undefined` when it swallowed an
    // S3ServiceException (see aws/s3.ts); the try/catch above already
    // guarantees both calls above completed without throwing, so — matching
    // the code's pre-existing (unguarded) assumption — both are treated as
    // defined from here on.
    const listedObjectsPublic = listedObjectsPublicResult!;
    const listedObjectsPublic_files = listedObjectsPublicFilesResult!;

    if ((listedObjectsPublic_files.Contents?.length || 0) > 0) {
      listedObjectsPublic_files.Contents!.forEach((Obj2) => {
        let file_found = false;
        if (message_a.length === 0) {
          delete_files_Params.Delete.Objects.push({ Key: Obj2.Key });
        }
        for (let i = 0; i < message_a.length; i += 1) {
          const file_name = (Obj2.Key || '').split('/')[2];
          const messageFiles = message_a[i]?.file || [];
          for (let k = 0; k < messageFiles.length; k += 1) {
            const filePath = messageFiles[k]?.path || '';
            if (file_name === 'img' || filePath.includes(file_name)) {
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

    logger.info('listedObjectsPublic', {
      listedObjectsPublic
    });
    if ((listedObjectsPublic.Contents?.length || 0) > 0) {
      listedObjectsPublic.Contents!.forEach((Obj) => {
        let file_found = false;
        if (message_a.length === 0) {
          deleteParams.Delete.Objects.push({ Key: Obj.Key });
        }
        for (let i = 0; i < message_a.length; i += 1) {
          const file_name = (Obj.Key || '').split('/')[3];
          const messageContent = message_a[i]?.message || '';
          if (messageContent.includes(file_name)) {
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
      logger.info('Deleted objects:', { objects: deleteParams.Delete.Objects });
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
      logger.info('Deleted objects:', {
        objects: delete_files_Params.Delete.Objects
      });
    } else {
      logger.info('No files to be deleted for threads.');
    }
  } catch (e) {
    logger.error('Error during garbage collection:', {
      error: e,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      threadId: ThreadId,
      collection,
      userFolder
    });
  }
};

export const TasksReminderEmails_Editor_core = async () => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  try {
    const editors = await UserService.findEditors({});

    const studentQuery: FilterQuery<IStudent> = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };

    const editorPromises = editors.map(async (editor) => {
      studentQuery.editors = editor._id;
      const editor_students = (await StudentService.getStudentsWithApplications(
        studentQuery
      )) as PendingTasksStudents;

      if (
        editor_students.length > 0 &&
        does_editor_have_pending_tasks(
          editor_students,
          editor as unknown as PendingTasksUser
        ) &&
        isNotArchiv(editor as unknown as PendingTasksUser)
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
  } catch (error) {
    logger.error('Error in TasksReminderEmails_Editor_core:', { error });
  }
};

export const TasksReminderEmails_Student_core = async () => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  try {
    const studentQuery = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    // TODO: it shows: "Technische Universität München (TUM) Computational Science and Engineering undefined"
    const students = await StudentService.getStudentsWithApplications(
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
  } catch (error) {
    logger.error('Error in TasksReminderEmails_Student_core:', { error });
  }
};

// Weekly called.
export const TasksReminderEmails = asyncHandler(async () => {
  await TasksReminderEmails_Editor_core();
  await TasksReminderEmails_Student_core();
});

export const _UrgentTasksReminderEmails_Student_core = async () => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  try {
    const trigger_days = 3;
    const studentQuery = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    const students = await StudentService.getStudentsWithApplications(
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
  } catch (error) {
    logger.error('Error in UrgentTasksReminderEmails_Student_core:', { error });
  }
};

export const _UrgentTasksReminderEmails_Agent_core = async () => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  try {
    const escalation_trigger_10days = 10;
    const escalation_trigger_3days = 3;
    const agents = await UserService.findAgents({});
    const studentQuery: FilterQuery<IStudent> = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    const agentPromises = agents.map(async (agent) => {
      studentQuery.agents = agent._id;
      const agent_students = (await StudentService.getStudentsWithApplications(
        studentQuery
      )) as PendingTasksStudents;
      if (agent_students.length > 0) {
        let cv_ml_rl_10days_flag = false;
        let cv_ml_rl_3days_flag = false;
        let deadline_within30days_flag = false;
        for (let x = 0; x < agent_students.length; x += 1) {
          deadline_within30days_flag ||= is_deadline_within30days_needed(
            agent_students[x]
          );
          cv_ml_rl_10days_flag ||= is_cv_ml_rl_reminder_needed(
            agent_students[x],
            agent as unknown as PendingTasksUser,
            escalation_trigger_10days
          );
          cv_ml_rl_3days_flag ||= is_cv_ml_rl_reminder_needed(
            agent_students[x],
            agent as unknown as PendingTasksUser,
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
  } catch (error) {
    logger.error('Error in UrgentTasksReminderEmails_Agent_core:', { error });
  }
};

export const _UrgentTasksReminderEmails_Editor_core = async () => {
  // Only inform active student
  // TODO: deactivate or change email frequency (default 1 week.)
  try {
    const editor_trigger_7days = 7;
    const editor_trigger_3days = 3;
    const studentQuery: FilterQuery<IStudent> = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    const editors = await UserService.findEditors({});

    // TODO: it shows: "Technische Universität München (TUM) Computational Science and Engineering undefined"
    // (O): Check if editor no reply (need to response) more than 3 days (Should configurable)
    for (let j = 0; j < editors.length; j += 1) {
      studentQuery.editors = editors[j]._id;
      const editor_students = (await StudentService.getStudentsWithApplications(
        studentQuery
      )) as PendingTasksStudents;
      if (editor_students.length > 0) {
        let cv_ml_rl_7days_flag = false;
        let cv_ml_rl_3days_flag = false;
        let deadline_within30days_flag = false;
        for (let x = 0; x < editor_students.length; x += 1) {
          deadline_within30days_flag ||= is_deadline_within30days_needed(
            editor_students[x]
          );
          cv_ml_rl_7days_flag ||= is_cv_ml_rl_reminder_needed(
            editor_students[x],
            editors[j] as unknown as PendingTasksUser,
            editor_trigger_7days
          );
          cv_ml_rl_3days_flag ||= is_cv_ml_rl_reminder_needed(
            editor_students[x],
            editors[j] as unknown as PendingTasksUser,
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
          logger.info(
            `Escalate: ${editors[j].firstname} ${editors[j].lastname}`
          );
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
  } catch (error) {
    logger.error('Error in UrgentTasksReminderEmails_Editor_core:', { error });
  }
};

export const UrgentTasksReminderEmails = async () => {
  const UrgentTaskPromises: Promise<void>[] = [
    // UrgentTasksReminderEmails_Editor_core(), // TODO: check if this is needed
    // UrgentTasksReminderEmails_Student_core(), // TODO: check if this is needed
    // UrgentTasksReminderEmails_Agent_core() // TODO: check if this is needed
  ];

  await Promise.all(UrgentTaskPromises);
};

export const NextSemesterCourseSelectionStudentReminderEmails = async () => {
  // Only inform active student
  try {
    const studentsWithCourses = await StudentService.getStudentsWithCourses();

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
  } catch (error) {
    logger.error('Error in NextSemesterCourseSelectionStudentReminderEmails:', {
      error
    });
  }
};

export const _NextSemesterCourseSelectionAgentReminderEmails = async () => {
  // Only inform active student
  try {
    const studentsWithCourses =
      await StudentService.getStudentsWithCoursesAndAgents();
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
  } catch (error) {
    logger.error('Error in NextSemesterCourseSelectionAgentReminderEmails:', {
      error
    });
  }
};

export const NextSemesterCourseSelectionReminderEmails = async () => {
  await NextSemesterCourseSelectionStudentReminderEmails();
  // await NextSemesterCourseSelectionAgentReminderEmails();
};

export const numStudentYearDistribution = (
  students: Array<Pick<IStudent, 'application_preference'>>
): Record<string, number> =>
  students.reduce((acc: Record<string, number>, student) => {
    const date =
      student.application_preference!.expected_application_date || 'TBD';
    acc[date] = (acc[date] || 0) + 1;
    return acc;
  }, {});

// export const UpdateStatisticsData = asyncHandler(async () => {
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

// `programId` is assumed populated (a full `IProgram`, not an ObjectId/string
// ref) — this mirrors every unguarded `.programId.<field>` access below.
type ApplicationWithProgram = Omit<IApplication, 'programId'> & {
  programId: IProgram;
};

export const add_portals_registered_status = (
  applications: ApplicationWithProgram[]
): ApplicationWithProgram[] => {
  const new_applications: ApplicationWithProgram[] = [];
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

export const MeetingDailyReminderChecker = async () => {
  try {
    const currentDate = new Date();
    const twentyFourHoursLater = new Date(currentDate);
    twentyFourHoursLater.setHours(currentDate.getHours() + 24);

    // Only future meeting within 24 hours, not past
    const upcomingEvents = await EventService.findEvents(
      {
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
      },
      {
        populate: {
          path: 'requester_id receiver_id',
          select: 'firstname lastname email'
        }
      }
    );
    if (upcomingEvents) {
      for (let j = 0; j < upcomingEvents.length; j += 1) {
        // FLAGGED BUG (pre-existing, preserved as-is — see
        // __tests__/utils/utils_function.test.ts "MeetingDailyReminderChecker
        // - branches"): this reads `.event_type` off the `upcomingEvents`
        // array rather than `upcomingEvents[j]`, so it's always `undefined`
        // and the Interview branch below never actually runs. Left
        // unchanged per instructions (no behavior changes); only cast here
        // for type-safety.
        if (
          (upcomingEvents as unknown as { event_type?: string }).event_type ===
          'Interview'
        ) {
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
  } catch (error) {
    logger.error('Error in MeetingDailyReminderChecker:', { error });
  }
};

// every day reminder
export const UnconfirmedMeetingDailyReminderChecker = async () => {
  try {
    const currentDate = new Date();

    // Only future meeting within 24 hours, not past
    const upcomingEvents = await EventService.findEvents(
      {
        $and: [
          {
            end: {
              $gte: currentDate
            }
          },
          {
            $or: [
              { isConfirmedReceiver: false },
              { isConfirmedRequester: false }
            ]
          }
        ]
      },
      {
        populate: {
          path: 'requester_id receiver_id',
          select: 'firstname lastname role email'
        }
      }
    );
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
  } catch (error) {
    logger.error('Error in UnconfirmedMeetingDailyReminderChecker:', { error });
  }
};

// Shared shape for the "message-like" values `CalculateInterval` /
// `CreateIntervalMessageOperation` / `CreateIntervalOperation` are invoked
// with: real Communication/Documentthread messages (which carry `_id`,
// `createdAt`, `updatedAt`, `user_id`, `ignore_message`), as well as the
// pseudo "now" placeholder (`{ updatedAt: now }`) used for the "still
// waiting on a reply" case — hence every field is optional.
type IntervalMessage = {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  ignore_message?: boolean;
  user_id?: { role?: string } | null;
};

export const CalculateInterval = (
  message1: Pick<IntervalMessage, 'createdAt'>,
  message2: Pick<IntervalMessage, 'createdAt'>
): number => {
  const intervalInDay =
    Math.abs(Number(message1.createdAt) - Number(message2.createdAt)) /
    (1000 * 60 * 60 * 24);
  return parseFloat(intervalInDay.toFixed(4));
};

export const GroupCommunicationByStudent = async () => {
  try {
    const communications =
      await CommunicationService.getAllForIntervalGrouping();
    const groupCommunication = communications.reduce(
      (acc: Record<string, typeof communications>, communication) => {
        // student_id is populated here, so it's the student doc, not an id ref.
        const student = communication.student_id as unknown as
          | { archiv?: boolean; _id: { toString(): string } }
          | null
          | undefined;

        if (student && !student.archiv) {
          const studentId = student._id.toString();

          if (!acc[studentId]) {
            acc[studentId] = [communication];
          } else {
            acc[studentId].push(communication);
          }
        }

        return acc;
      },
      {}
    );
    return groupCommunication;
  } catch (error) {
    logger.error('Error in GroupCommunicationByStudent:', { error });
    return undefined;
  }
};

export const CreateIntervalMessageOperation = (
  student_id: unknown,
  msg1: IntervalMessage,
  msg2: IntervalMessage
) => {
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

  // FLAGGED BUG (pre-existing, preserved as-is): the comment says this
  // excludes `updatedAt`, but it destructures `_updatedAt`, which doesn't
  // exist on `intervalData` (the real field is `updatedAt`, no underscore).
  // So `_updatedAt` is always undefined and `queryData` actually retains
  // `updatedAt` (a fresh `new Date()`), which likely breaks the intended
  // upsert de-duplication. Left unchanged per instructions; cast only so the
  // (harmless at runtime) destructure of a non-existent key still typechecks.
  const { _updatedAt, ...queryData } = intervalData as typeof intervalData & {
    _updatedAt?: unknown;
  };

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
export const ProcessMessages = (
  student: unknown,
  messages: IntervalMessage[]
): Array<ReturnType<typeof CreateIntervalMessageOperation>> => {
  const bulkOps: Array<ReturnType<typeof CreateIntervalMessageOperation>> = [];
  const now = new Date();

  // If no messages, return empty array
  if (!messages.length) return bulkOps;

  // Sort messages chronologically
  messages.sort((a, b) => Number(a.updatedAt) - Number(b.updatedAt));

  let lastValidStudentMsg: IntervalMessage | undefined;

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

export const ProcessThread = (thread: {
  _id: unknown;
  file_type?: string;
  messages?: IntervalMessage[];
}): Array<ReturnType<typeof CreateIntervalOperation>> => {
  const bulkOps: Array<ReturnType<typeof CreateIntervalOperation>> = [];
  const now = new Date();

  // If no messages in thread, return empty array
  if (!thread.messages?.length) return bulkOps;

  // Sort messages chronologically
  thread.messages.sort((a, b) => Number(a.updatedAt) - Number(b.updatedAt));

  let lastValidStudentMsg: IntervalMessage | undefined;

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
      logger.error('Error processing message:', { error });
    }
  }

  return bulkOps;
};

export const FindIntervalInCommunicationsAndSave = async () => {
  try {
    // TODO: active student's message only (should already done, please check GroupCommunicationByStudent)
    const groupCommunication = await GroupCommunicationByStudent();
    const bulkOps: Array<ReturnType<typeof CreateIntervalMessageOperation>> =
      [];

    // FLAGGED BUG (pre-existing, preserved as-is): `GroupCommunicationByStudent`
    // returns `undefined` if it hits its own catch block, and `Object.entries`
    // would then throw at runtime. Cast (not guarded) to keep behavior
    // unchanged; a `|| {}` fallback would be a real, if arguably desirable,
    // behavior change.
    for (const [student, messages] of Object.entries(
      groupCommunication as Record<string, IntervalMessage[]>
    )) {
      const studentBulkOps = ProcessMessages(student, messages);
      bulkOps.push(...studentBulkOps);
    }

    if (bulkOps.length > 0) {
      const result = await IntervalService.bulkWrite(
        bulkOps as AnyBulkWriteOperation<IInterval>[]
      );
      logger.info(
        'FindIntervalInCommunicationsAndSave: Bulk operation result:',
        { result }
      );
    }
  } catch (error) {
    logger.error('Error finding valid interval:', { error });
  }
};

export const CreateIntervalOperation = (
  thread: { _id: unknown; file_type?: string },
  msg1: IntervalMessage,
  msg2: IntervalMessage
) => {
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

  // FLAGGED BUG (pre-existing, preserved as-is): see the identical note in
  // `CreateIntervalMessageOperation` above — this destructures `_updatedAt`
  // (which doesn't exist on `intervalData`) instead of `updatedAt`, so
  // `queryData` still carries the fresh `updatedAt` timestamp.
  const { _updatedAt, ...queryData } = intervalData as typeof intervalData & {
    _updatedAt?: unknown;
  };

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

export const FetchStudentsForDocumentThreads = async (
  filter: FilterQuery<IStudent>
) => StudentService.getStudentsForDocumentThreadIntervals(filter);

export const FindIntervalInDocumentThreadAndSave = async () => {
  try {
    // calculate active student only
    const students = await FetchStudentsForDocumentThreads({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    const bulkOps: Array<ReturnType<typeof CreateIntervalOperation>> = [];

    for (const student of students) {
      try {
        for (const generaldocs_thread of student.generaldocs_threads) {
          // `doc_thread_id` is typed as the unpopulated ref union
          // (IDocumentthread | ObjectId | string), but the DAO query
          // (`getStudentsForDocumentThreadIntervals`) always populates it.
          const thread =
            generaldocs_thread.doc_thread_id as unknown as Parameters<
              typeof ProcessThread
            >[0];
          const threadBulkOps = ProcessThread(thread);
          bulkOps.push(...threadBulkOps);
        }
      } catch (e) {
        logger.error('Error retrieving general docs', { error: e });
      }

      // TODO:deprecated. use Application model instead
      // try {
      //   for (const application of student.applications) {
      //     for (const doc_thread_id of application.doc_modification_thread) {
      //       const thread = doc_thread_id.doc_thread_id;
      //       const threadBulkOps = ProcessThread(thread);
      //       bulkOps.push(...threadBulkOps);
      //     }
      //   }
      // } catch (e) {
      //   logger.error('Error retrieving application docs', e);
      // }
    }

    if (bulkOps.length > 0) {
      const result = await IntervalService.bulkWrite(
        bulkOps as AnyBulkWriteOperation<IInterval>[]
      );
      logger.info(
        'FindIntervalInDocumentThreadAndSave: Bulk operation result:',
        { result }
      );
    }
  } catch (error) {
    logger.error('Error in FindIntervalInDocumentThreadAndSave:', { error });
  }
};

// `IntervalService.findAllPopulated()` runs `.populate('thread_id
// student_id')`, but `IInterval` declares those refs as plain
// `Schema.Types.ObjectId`, so the populated shape (each carrying its own
// `_id`, and `thread_id` additionally carrying the thread's `student_id`) is
// declared locally here to match what the code below actually reads.
type PopulatedIntervalRef = { _id: { toString(): string } };
type PopulatedInterval = {
  student_id?: PopulatedIntervalRef | null;
  thread_id?:
    | (PopulatedIntervalRef & { student_id?: { toString(): string } })
    | null;
  interval_type: string;
  interval: number;
};

export const GroupIntervals = async () => {
  try {
    const intervals =
      (await IntervalService.findAllPopulated()) as unknown as PopulatedInterval[];
    const studentGroupInterval: Record<string, PopulatedInterval[]> = {};
    const documentThreadGroupInterval: Record<string, PopulatedInterval[]> = {};
    intervals.forEach((singleInterval) => {
      const { student_id, thread_id } = singleInterval;
      const key = student_id
        ? student_id._id.toString()
        : thread_id!._id.toString();
      const group = student_id
        ? studentGroupInterval
        : documentThreadGroupInterval;
      if (!group[key]) {
        group[key] = [singleInterval];
      } else {
        group[key].push(singleInterval);
      }
    });
    return [studentGroupInterval, documentThreadGroupInterval] as const;
  } catch (error) {
    logger.error('Error grouping communications:', { error });
    return null;
  }
};

// Extract plain text from a document buffer. Supports pdf/docx (via pdf-parse /
// mammoth) and plain text formats. Returns '' for unsupported types or on
// extraction failure. Shared by patternMatched and the AI Assist read_document
// tool.
export const extractTextFromBuffer = async (
  fileBuffer: Buffer,
  extension: string
): Promise<string> => {
  const ext = String(extension || '')
    .toLowerCase()
    .replace(/^\./, '');

  try {
    if (ext === 'pdf') {
      const result = await PdfParse(fileBuffer);
      return result?.text || '';
    }

    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result?.value || '';
    }

    if (ext === 'txt' || ext === 'md' || ext === 'csv') {
      return Buffer.isBuffer(fileBuffer)
        ? fileBuffer.toString('utf8')
        : Buffer.from(fileBuffer).toString('utf8');
    }
  } catch (error) {
    logger.error('extractTextFromBuffer failed', { error });
  }

  return '';
};

export const patternMatched = async (
  fileBuffer: Buffer,
  extension: string,
  patterns: string[]
): Promise<boolean> => {
  const text = (
    await extractTextFromBuffer(fileBuffer, extension)
  ).toLowerCase();
  if (!text) return false; // Early return if text extraction failed

  return patterns
    .map((pattern) => pattern.toLowerCase())
    .some((pattern) => text.includes(pattern));
};

export const CalculateAverageResponseTimeAndSave = async () => {
  try {
    const [studentGroupInterval, documentThreadGroupInterval] =
      (await GroupIntervals()) as [
        Record<string, PopulatedInterval[]>,
        Record<string, PopulatedInterval[]>
      ];
    const calculateAndSaveAverage = async (
      groupInterval: Record<string, PopulatedInterval[]>,
      idKey: 'student_id' | 'thread_id'
    ) => {
      try {
        const bulkOps: Array<Record<string, unknown>> = [];

        // Prepare the bulk operations
        for (const key in groupInterval) {
          const intervals = groupInterval[key];
          const total = intervals.reduce(
            (sum: number, interval) => sum + interval.interval,
            0
          );
          // `intervalAvg` on `IResponseTime` is typed `number`; `.toFixed(2)`
          // still rounds to 2 decimals exactly as before, just converted back
          // to a number instead of leaving it as a string.
          const final_avg = Number((total / intervals.length).toFixed(2));

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
                student_id: singleInterval.thread_id?.student_id?.toString(),
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
          const result = await ResponseTimeService.bulkWrite(
            bulkOps as unknown as AnyBulkWriteOperation<IResponseTime>[]
          );
          logger.info('calculateAndSaveAverage: Bulk operation result:', {
            result
          });
        }
      } catch (err) {
        logger.error(
          `Error calculating and saving average response time for ${idKey}:`,
          { error: err }
        );
      }
    };

    await calculateAndSaveAverage(studentGroupInterval, 'student_id');
    await calculateAndSaveAverage(documentThreadGroupInterval, 'thread_id');
  } catch (error) {
    logger.error('Error in CalculateAverageResponseTimeAndSave:', { error });
  }
};

export const DailyCalculateAverageResponseTime = async () => {
  await FindIntervalInCommunicationsAndSave();
  await FindIntervalInDocumentThreadAndSave();
  await CalculateAverageResponseTimeAndSave();
};

export const DailyInterviewSurveyChecker = async () => {
  try {
    // TODO: find today meeting and send email reminder (only once)
    const currentDate = new Date();
    const twentyFourHoursAgo = new Date(currentDate);
    twentyFourHoursAgo.setHours(currentDate.getHours() - 24);
    // interviews took place within last 24 hours
    const interviewTookPlacedToday = await InterviewService.findInterviews(
      {
        interview_date: {
          $gte: twentyFourHoursAgo.toISOString(),
          $lt: currentDate
        }
      },
      [
        ['student_id', 'firstname lastname email'],
        ['program_id', 'school program_name degree semester']
      ]
    );

    // send interview survey request email
    interviewTookPlacedToday?.map(
      (interview: {
        student_id: { firstname?: string; lastname?: string; email?: string };
      }) =>
        InterviewSurveyRequestEmail(
          {
            firstname: interview.student_id.firstname,
            lastname: interview.student_id.lastname,
            address: interview.student_id.email
          },
          { interview }
        )
    );
  } catch (error) {
    logger.error('Error in DailyInterviewSurveyChecker:', { error });
  }
};

// every day reminder
// TODO: (O)no trainer, no date.
export const NoInterviewTrainerOrTrainingDateDailyReminderChecker =
  async () => {
    try {
      const currentDate = new Date();
      const currentDateString = currentDate.toISOString().split('T')[0]; // Converts to 'YYYY-MM-DD' format

      // Only future meeting within 24 hours, not past
      const interviewRequests = await InterviewService.findInterviews(
        {
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
        },
        [['student_id', 'firstname lastname role email'], ['program_id']]
      );

      // TODO: reminder agent as well

      if (interviewRequests?.length > 0) {
        const permissions = await PermissionService.findPermissionsWithUser({
          canAssignEditors: true
        });
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
    } catch (error) {
      logger.error(
        'Error in NoInterviewTrainerOrTrainingDateDailyReminderChecker:',
        { error }
      );
    }
  };

// Existing team member shape this helper compares against — student/editor
// `agents`/`editors` and interview `trainer_id`, all populated arrays of user
// documents carrying at least these fields.
type ExistingTeamUser = {
  _id: { toString(): string };
  firstname?: string;
  lastname?: string;
  email?: string;
  archiv?: boolean;
};

export const userChangesHelperFunction = async (
  newUserIds: Record<string, boolean>,
  existingUsers: ExistingTeamUser[] | undefined
) => {
  const newUserIdsArr = Object.keys(newUserIds);
  const updatedUserIds = newUserIdsArr.filter(
    (editorId) => newUserIds[editorId]
  );

  // Fetch editors concurrently
  const users = await Promise.all(
    updatedUserIds.map((id) =>
      UserService.getUserByIdSelect(id, 'firstname lastname email archiv')
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
  // Note: `usr` can be `null` here (a stale/deleted id in `newUserIds` makes
  // `getUserByIdSelect` resolve to null) — pre-existing, unguarded assumption
  // that every id resolves; preserved as-is (non-null assertion only).
  const addedUsers = users.filter(
    (usr) => !previousEditorSet.has(usr!._id.toString())
  );
  const removedUsers = beforeChangeUsersArr.filter(
    (usr) => !newEditorSet.has(usr._id.toString())
  );

  const toBeInformedUsers: Array<{
    firstname?: string | null;
    lastname?: string | null;
    archiv?: boolean;
    email?: string | null;
  }> = [];
  const updatedUsers: Array<{
    firstname?: string | null;
    lastname?: string | null;
    email?: string | null;
  }> = [];

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
