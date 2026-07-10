import mongoose from 'mongoose';
import path from 'path';
import { Request } from 'express';
import {
  Role,
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Admin,
  is_TaiGer_Student,
  isProgramDecided
} from '@taiger-common/core';
import type { IUser } from '@taiger-common/model';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import { ten_minutes_cache, two_minutes_cache } from '../cache/node-cache';
import { informOnSurveyUpdate } from '../utils/informEditor';
import {
  sendNewApplicationMessageInThreadEmail,
  sendAssignEditorReminderEmail,
  sendNewGeneraldocMessageInThreadEmail,
  sendSetAsFinalGeneralFileForAgentEmail,
  sendSetAsFinalGeneralFileForStudentEmail,
  sendSetAsFinalProgramSpecificFileForStudentEmail,
  sendSetAsFinalProgramSpecificFileForAgentEmail,
  assignDocumentTaskToEditorEmail,
  assignDocumentTaskToStudentEmail,
  sendAssignEssayWriterReminderEmail,
  assignEssayTaskToEditorEmail,
  sendAssignTrainerReminderEmail,
  sendNewInterviewMessageInThreadEmail,
  informEssayWriterNewEssayEmail,
  informStudentTheirEssayWriterEmail,
  informAgentEssayAssignedEmail
} from '../services/email';
import logger from '../services/logger';
import {
  General_Docs,
  GENERAL_RLs_CONSTANT,
  application_deadline_V2_calculator,
  isNotArchiv,
  CVDeadline_Calculator,
  General_RL_Deadline_Calculator,
  EDITOR_SCOPE,
  ESSAY_WRITER_SCOPE,
  CV_MUST_HAVE_PATTERNS
} from '../constants';

import { AWS_S3_BUCKET_NAME, ORIGIN } from '../config';
import { deleteS3Objects, getS3Object } from '../aws/s3';
import { emptyS3Directory } from '../utils/modelHelper/versionControl';
import {
  threadS3GarbageCollector,
  patternMatched,
  userChangesHelperFunction
} from '../utils/utils_function';
import StudentService from '../services/students';
import DocumentThreadService from '../services/documentthreads';
import UserService from '../services/users';
import ApplicationService from '../services/applications';
import SurveyInputService from '../services/surveyInputs';
import PermissionService from '../services/permissions';
import InterviewService from '../services/interviews';
import AuditService from '../services/audit';
import ForwardDocumentsService from '../services/forwardDocuments';
import DocumentthreadQueryBuilder from '../builders/DocumentthreadQueryBuilder';

// ---------------------------------------------------------------------------
// Local populated/lean shapes.
//
// The document-thread / student / application service reads in this controller
// return Mongoose `.populate(...).lean()` results whose inferred types collapse
// to a loose `FlattenMaps<any>` union (or, for the model interfaces, keep
// reference fields as `ObjectId | string` unions). The handlers below consume
// these as *populated* objects (e.g. `thread.student_id.firstname`). These
// interfaces describe the runtime shape the handlers actually read so the
// controller can be typed without `as any`. They are intentionally permissive
// (optional fields, `Record`-style notification) to mirror the real documents
// without over-constraining behavior.
// ---------------------------------------------------------------------------
interface PopulatedUserRef {
  _id: mongoose.Types.ObjectId | string;
  firstname?: string;
  lastname?: string;
  email?: string;
  role?: string;
  archiv?: boolean;
  pictureUrl?: string;
}

interface PopulatedProgramRef {
  _id: mongoose.Types.ObjectId | string;
  school?: string;
  program_name?: string;
  degree?: string;
  semester?: string;
  application_year?: string;
}

interface PopulatedStudent {
  _id: mongoose.Types.ObjectId | string;
  firstname?: string;
  lastname?: string;
  email?: string;
  archiv?: boolean;
  agents: PopulatedUserRef[];
  editors: PopulatedUserRef[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notification: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generaldocs_threads: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applications?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface PopulatedThreadMessageFile {
  name: string;
  path: string;
}

interface PopulatedThreadMessage {
  _id: mongoose.Types.ObjectId | string;
  user_id?: PopulatedUserRef | mongoose.Types.ObjectId | string;
  message?: string;
  createdAt?: Date;
  updatedAt?: Date;
  file?: PopulatedThreadMessageFile[];
}

interface PopulatedThread {
  _id: mongoose.Types.ObjectId | string;
  student_id: PopulatedStudent;
  program_id?: PopulatedProgramRef;
  // `application_id` is polymorphic: it is the raw ObjectId on some reads and a
  // populated application (with `application_year`) on others, depending on the
  // service method. Typed loosely to mirror that runtime reality.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  application_id?: any;
  outsourced_user_id: PopulatedUserRef[];
  flag_by_user_id?: (mongoose.Types.ObjectId | string)[];
  file_type: string;
  isFinalVersion?: boolean;
  isOriginAuthorDeclarationConfirmedByStudent?: boolean;
  messages: PopulatedThreadMessage[];
  updatedAt?: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  save?: () => Promise<any>;
}

interface SurveyInputDoc {
  _id: mongoose.Types.ObjectId | string;
  studentId?: mongoose.Types.ObjectId | string;
  programId?: mongoose.Types.ObjectId | string | null;
  fileType?: string;
}

// Notification email payload. Several handlers build a base payload then
// conditionally attach `school`/`program_name`/`program`/`interview_id`/
// `message`. Typed permissively so those later assignments stay valid without
// changing the runtime objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmailPayload = Record<string, any>;

const getActiveThreads = asyncHandler(async (req, res) => {
  const {
    file_type,
    isFinalVersion,
    hasOutsourcedUserId,
    hasMessages,
    outsourcedUserId
  } = req.query;

  const { filter } = new DocumentthreadQueryBuilder()
    .withFileType(file_type)
    .withIsFinalVersion(isFinalVersion)
    .withHasOutsourcedUserId(hasOutsourcedUserId)
    .withHasMessages(hasMessages)
    .withOutsourcedUserId(outsourcedUserId)
    .build();

  const threads = await DocumentThreadService.getAllStudentsThreads(filter);

  res.status(200).send({ success: true, data: threads });
});

// Active (non-archived) student ids, cached briefly. This set changes rarely
// (a student is onboarded or archived) — not per page view — so caching it
// avoids re-querying on every pagination/counts request that the thread
// dashboards fire. Trade-off: a newly created or archived student can take up
// to the cache TTL (2 min) to appear/disappear from the boards.
const ACTIVE_STUDENT_IDS_CACHE_KEY = 'active_student_ids';

const getActiveStudentIds = async (): Promise<string[]> => {
  const cached = two_minutes_cache.get(ACTIVE_STUDENT_IDS_CACHE_KEY) as
    | string[]
    | undefined;
  if (cached) {
    return cached;
  }

  const activeStudents = await StudentService.fetchStudentIds({
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  });
  const studentIds = activeStudents.map((student) => student._id.toString());
  two_minutes_cache.set(ACTIVE_STUDENT_IDS_CACHE_KEY, studentIds);
  return studentIds;
};

const getActiveThreadsPaginated = asyncHandler(async (req, res) => {
  const studentIds = await getActiveStudentIds();

  const result = await DocumentThreadService.getActiveThreadsPaginated({
    studentIds,
    query: req.query
  });

  res.status(200).send({ success: true, data: result });
});

const getActiveThreadsCounts = asyncHandler(async (req, res) => {
  const studentIds = await getActiveStudentIds();

  const data = await DocumentThreadService.getActiveThreadsCounts({
    studentIds,
    query: req.query
  });

  res.status(200).send({ success: true, data });
});

// Active students supervised (agent/editor) by this user. Essay threads
// outsourced to the user are added by the service via `outsourcedUserId`.
const supervisedActiveStudentIds = async (req: Request, userId: string) => {
  const students = await StudentService.fetchStudentIds({
    $and: [
      { $or: [{ archiv: { $exists: false } }, { archiv: false }] },
      { $or: [{ agents: userId }, { editors: userId }] }
    ]
  });
  return students.map((student) => student._id.toString());
};

const getMyStudentsThreadsPaginated = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const studentIds = await supervisedActiveStudentIds(req, userId);

  const result = await DocumentThreadService.getActiveThreadsPaginated({
    studentIds,
    outsourcedUserId: userId,
    query: { ...req.query, viewerId: req.query.viewerId || userId }
  });

  res.status(200).send({ success: true, data: result });
});

const getMyStudentsThreadsCounts = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const studentIds = await supervisedActiveStudentIds(req, userId);

  const data = await DocumentThreadService.getActiveThreadsCounts({
    studentIds,
    outsourcedUserId: userId,
    query: { ...req.query, viewerId: req.query.viewerId || userId }
  });

  res.status(200).send({ success: true, data });
});

const getMyStudentsThreads = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { isFinalVersion, fileType } = req.query;
  const { filter: documentThreadFilter } = new DocumentthreadQueryBuilder()
    .withIsFinalVersion(isFinalVersion)
    .withFileType(fileType)
    .build();
  const threads = await DocumentThreadService.getStudentsThreadsByTaiGerUserId(
    userId,
    documentThreadFilter
  );
  const user = await UserService.getUserById(userId);
  res.status(200).send({ success: true, data: { threads, user } });
});

const getSurveyInputDocuments = async (
  req: Request,
  studentId: string,
  programId: string | undefined,
  fileType: string
) => {
  const document = (await SurveyInputService.findSurveyInputs({
    studentId,
    ...(fileType ? { fileType } : {}),
    ...(programId ? { programId: { $in: [programId, null] } } : {})
  })) as unknown as SurveyInputDoc[];

  const surveys = {
    general: document.find((doc) => !doc.programId),
    specific: programId && document.find((doc) => doc.programId)
  };

  return surveys;
};

const getSurveyInputs = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId }
  } = req;
  const threadDocument = (await DocumentThreadService.getThreadById(
    messagesThreadId
  )) as PopulatedThread | null;

  if (!threadDocument) {
    logger.error(
      `getSurveyInputs: Invalid message thread id! (${messagesThreadId})`
    );
    throw new ErrorResponse(404, 'Message thread not found');
  }

  const surveyDocument = await getSurveyInputDocuments(
    req,
    threadDocument.student_id._id.toString(),
    threadDocument?.program_id
      ? threadDocument.program_id._id.toString()
      : undefined,
    threadDocument.file_type
  );

  const document = {
    ...threadDocument,
    surveyInputs: surveyDocument
  };

  res.status(200).send({ success: true, data: document });
});

const postSurveyInput = asyncHandler(async (req, res) => {
  const { user } = req;
  const { input, informEditor } = req.body;
  const newSurvey = (await SurveyInputService.createSurveyInput({
    ...input,
    createdAt: new Date()
  })) as unknown as SurveyInputDoc;
  res.status(200).send({ success: true, data: newSurvey });

  if (informEditor) {
    const thread = await DocumentThreadService.findOneThreadPopulated(
      {
        student_id: newSurvey.studentId,
        program_id: newSurvey.programId,
        file_type: newSurvey.fileType
      },
      [['program_id']]
    );
    informOnSurveyUpdate(user, newSurvey, thread);
  }
});

const putSurveyInput = asyncHandler(async (req, res) => {
  const {
    user,
    params: { surveyInputId }
  } = req;
  const { input, informEditor } = req.body;
  const updatedSurvey = (await SurveyInputService.updateSurveyInputById(
    surveyInputId,
    {
      ...input,
      updatedAt: new Date()
    }
  )) as unknown as SurveyInputDoc | null;

  res.status(200).send({ success: true, data: updatedSurvey });

  if (informEditor && updatedSurvey) {
    const thread = await DocumentThreadService.findOneThreadPopulated(
      {
        student_id: updatedSurvey.studentId,
        program_id: updatedSurvey.programId,
        file_type: updatedSurvey.fileType
      },
      [['program_id']]
    );
    informOnSurveyUpdate(user, updatedSurvey, thread);
  }
});

// (O) email inform student
// (O) email inform editors.
const initGeneralMessagesThread = asyncHandler(async (req, res) => {
  const {
    params: { studentId, document_category }
  } = req;
  const student = (await StudentService.getStudentDocByIdPopulated(studentId, [
    ['generaldocs_threads.doc_thread_id'],
    ['agents editors', 'firstname lastname email pictureUrl']
  ])) as unknown as PopulatedStudent | null;

  if (!student) {
    logger.info('initGeneralMessagesThread: Invalid student id');
    throw new ErrorResponse(404, 'Student Id not found');
  }

  const doc_thread_existed = await DocumentThreadService.findOneThreadDoc({
    student_id: studentId,
    program_id: null,
    file_type: document_category
  });

  if (doc_thread_existed) {
    // should add the existing one thread to student generaldocs
    const thread_in_student_generaldoc_existed =
      student.generaldocs_threads.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ doc_thread_id }: any) =>
          doc_thread_id._id.toString() === doc_thread_existed._id.toString()
      );
    // if thread existed but not in student application thread, then add it.
    if (!thread_in_student_generaldoc_existed) {
      const app = student.generaldocs_threads.create({
        doc_thread_id: doc_thread_existed,
        updatedAt: new Date(),
        createdAt: new Date()
      });
      student.generaldocs_threads.push(app);
      student.notification.isRead_new_cvmlrl_tasks_created = false;
      await student.save();
      return res.status(200).send({ success: true, data: app });
    }
    logger.info('initGeneralMessagesThread: Document Thread already existed!');
    throw new ErrorResponse(409, 'Document Thread already existed!');
  }
  const new_doc_thread = DocumentThreadService.newThread({
    student_id: studentId,
    file_type: document_category,
    program_id: null,
    updatedAt: new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const temp = student.generaldocs_threads.create({
    doc_thread_id: new_doc_thread,
    updatedAt: new Date(),
    createdAt: new Date()
  });
  student.generaldocs_threads.push(temp);
  student.notification.isRead_new_cvmlrl_tasks_created = false;
  await student.save();
  await new_doc_thread.save();

  res.status(200).send({ success: true, data: temp });
  // TODO: Email notification
  const documentname = document_category;
  for (let i = 0; i < student.editors.length; i += 1) {
    if (isNotArchiv(student)) {
      assignDocumentTaskToEditorEmail(
        {
          firstname: student.editors[i].firstname,
          lastname: student.editors[i].lastname,
          address: student.editors[i].email
        },
        {
          student_firstname: student.firstname,
          student_lastname: student.lastname,
          thread_id: new_doc_thread._id,
          documentname,
          updatedAt: new Date()
        }
      );
    }
  }
  if (isNotArchiv(student)) {
    await assignDocumentTaskToStudentEmail(
      {
        firstname: student.firstname,
        lastname: student.lastname,
        address: student.email
      },
      { documentname, updatedAt: new Date(), thread_id: new_doc_thread._id }
    );
  }
});

// (O) email inform Editor
// (O) email inform Student
// (O) Tested
const initApplicationMessagesThread = asyncHandler(async (req, res) => {
  const {
    params: { studentId, application_id, document_category }
  } = req;

  const newAppRecord = await DocumentThreadService.createApplicationThread(
    studentId,
    application_id,
    document_category
  );
  res.status(200).send({ success: true, data: newAppRecord });

  const student = (await StudentService.getStudentById(
    studentId
  )) as unknown as PopulatedStudent | null;
  if (!student) {
    logger.error('initApplicationMessagesThread: Invalid student id');
    return;
  }

  const applications = (await ApplicationService.getApplicationsByStudentId(
    studentId
  )) as unknown as {
    _id: mongoose.Types.ObjectId | string;
    programId?: PopulatedProgramRef;
  }[];

  const program = applications.find(
    (app) => app._id.toString() === application_id
  )?.programId;
  const Essay_Writer_Scope = Object.keys(ESSAY_WRITER_SCOPE);
  const program_name = `${program?.school} - ${program?.program_name}`;
  if (Essay_Writer_Scope.includes(document_category)) {
    const permissions = await PermissionService.findPermissionsWithUser(
      { canAssignEditors: true },
      'firstname lastname email archiv pictureUrl'
    );
    if (permissions) {
      for (let x = 0; x < permissions.length; x += 1) {
        if (isNotArchiv(permissions[x].user_id)) {
          assignEssayTaskToEditorEmail(
            {
              firstname: permissions[x].user_id.firstname,
              lastname: permissions[x].user_id.lastname,
              address: permissions[x].user_id.email
            },
            {
              student_firstname: student.firstname,
              student_lastname: student.lastname,
              student_id: student._id.toString(),
              thread_id: newAppRecord.doc_thread_id._id,
              document_category,
              program_name,
              updatedAt: new Date()
            }
          );
        }
      }
    }
  }
  const documentname = document_category;

  for (let i = 0; i < student.editors.length; i += 1) {
    if (isNotArchiv(student.editors[i])) {
      if (!Essay_Writer_Scope.includes(document_category)) {
        assignDocumentTaskToEditorEmail(
          {
            firstname: student.editors[i].firstname,
            lastname: student.editors[i].lastname,
            address: student.editors[i].email
          },
          {
            student_firstname: student.firstname,
            student_lastname: student.lastname,
            thread_id: newAppRecord.doc_thread_id._id,
            documentname,
            updatedAt: new Date()
          }
        );
      }
    }
  }
  if (isNotArchiv(student)) {
    assignDocumentTaskToStudentEmail(
      {
        firstname: student.firstname,
        lastname: student.lastname,
        address: student.email
      },
      {
        documentname,
        updatedAt: new Date(),
        thread_id: newAppRecord.doc_thread_id._id
      }
    );
  }
});

const putThreadFavorite = asyncHandler(async (req, res) => {
  const {
    user,
    params: { messagesThreadId }
  } = req;
  const thread = (await DocumentThreadService.getThreadById(
    messagesThreadId
  )) as PopulatedThread | null;
  if (!thread) {
    logger.error('putThreadFavorite: Invalid message thread id!');
    throw new ErrorResponse(404, 'Thread not found');
  }

  // Convert user._id to string for consistent comparison
  const userIdString = user._id.toString();

  // Check if user ID exists in the flag_by_user_id array
  // (convert ObjectIds to strings for comparison)
  const isFlagged = thread.flag_by_user_id?.some(
    (id) => id.toString() === userIdString
  );

  try {
    if (isFlagged) {
      // Remove user from favorites
      await DocumentThreadService.updateThreadById(messagesThreadId, {
        $pull: { flag_by_user_id: user._id }
      });
    } else {
      // Add user to favorites
      await DocumentThreadService.updateThreadById(messagesThreadId, {
        $addToSet: { flag_by_user_id: user._id }
      });
    }

    res.status(200).send({
      success: true,
      data: {
        isFlagged: !isFlagged // Return the new state
      }
    });
  } catch (error) {
    logger.error(
      'putThreadFavorite: Failed to update thread favorite status',
      error as Record<string, unknown>
    );
    throw new ErrorResponse(500, 'Failed to update favorite status');
  }
});

const checkDocumentPattern = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId, file_type }
  } = req;
  // don't check non-CV doc at the moment
  if (file_type !== 'CV' || file_type !== 'CV_US') {
    return res.status(200).send({
      success: true,
      isPassed: true
    });
  }
  const document_thread = (await DocumentThreadService.getThreadByIdLean(
    messagesThreadId
  )) as PopulatedThread | null;
  if (!document_thread) {
    logger.error('checkDocumentPattern: thread not found!');
    throw new ErrorResponse(404, 'Thread Id not found');
  }

  // Step 1
  // Get last CV keys
  const documentKeys = document_thread.messages
    .filter((message) => (message.file?.length ?? 0) > 0)
    .map((message) => message.file as PopulatedThreadMessageFile[]);
  if (documentKeys?.length === 0) {
    return res.status(200).send({
      success: true,
      isPassed: true
    });
  }
  const latestFiles = documentKeys[documentKeys.length - 1];
  // Step 2
  // fetch CV pdf
  try {
    const dataArray = await Promise.all(
      latestFiles.map((file) => getS3Object(AWS_S3_BUCKET_NAME, file.path))
    );

    // Convert each data into a Buffer
    const buffers = dataArray.map((data) => Buffer.from(data as Uint8Array));

    // Step 3
    // find if keywords exist in the pdf / docx
    let idx = 0;

    for (const buffer of buffers) {
      const extension = (
        latestFiles[idx].name.split('.').pop() ?? ''
      ).toLowerCase();
      if (await patternMatched(buffer, extension, CV_MUST_HAVE_PATTERNS)) {
        return res.status(200).send({
          success: true,
          isPassed: true
        });
      }
      idx += 1;
    }
    // Step 4
    // fals if no found.
    res.status(200).send({
      success: true,
      isPassed: false,
      reason: `${CV_MUST_HAVE_PATTERNS.map((pattern) => `"${pattern}"`).join(
        ', '
      )}`
    });
  } catch (e) {
    res.status(200).send({
      success: true,
      isPassed: false
    });
  }
});

const getMessages = asyncHandler(async (req, res) => {
  const {
    user,
    params: { messagesThreadId }
  } = req;
  const document_thread = (await DocumentThreadService.getThreadById(
    messagesThreadId
  )) as PopulatedThread | null;
  if (!document_thread) {
    logger.error('getMessages: Invalid message thread id');
    throw new ErrorResponse(404, 'Thread not found');
  }

  const similarThreads = document_thread?.program_id
    ? await DocumentThreadService.getThreads({
        _id: { $ne: messagesThreadId },
        program_id: document_thread.program_id,
        isFinalVersion: true,
        file_type: document_thread.file_type
      })
    : null;

  const threadAuditLogPromise = AuditService.getAuditLogs(
    { targetDocumentThreadId: messagesThreadId },
    { sort: { createdAt: -1 } } as unknown as {
      limit: number;
      skip: number;
      sort: Record<string, 1 | -1>;
    }
  );

  const agentsPromise = UserService.findAgents(
    { _id: document_thread.student_id.agents },
    'firstname lastname pictureUrl'
  );
  const editorsPromise = UserService.findEditors(
    { _id: document_thread.student_id.editors },
    'firstname lastname pictureUrl'
  );
  const applicationsPromise = ApplicationService.findByStudentIdWithProgram(
    document_thread.student_id._id.toString()
  );

  const [agents, editors, applications, threadAuditLog] = await Promise.all([
    agentsPromise,
    editorsPromise,
    applicationsPromise,
    threadAuditLogPromise
  ]);

  let deadline = 'x';
  if (GENERAL_RLs_CONSTANT.includes(document_thread.file_type)) {
    deadline = General_RL_Deadline_Calculator(applications);
  } else if (General_Docs.includes(document_thread.file_type)) {
    deadline = CVDeadline_Calculator(applications);
  } else {
    const application = await ApplicationService.getApplicationById(
      document_thread.application_id
    );
    deadline = application_deadline_V2_calculator(application);
  }

  // Find conflict list:
  let conflict_list = [];
  if (
    document_thread.application_id &&
    (is_TaiGer_Admin(user) || is_TaiGer_Agent(user) || is_TaiGer_Editor(user))
  ) {
    conflict_list = await ApplicationService.findConflictApplications({
      studentId: { $ne: document_thread.student_id._id.toString() },
      programId: document_thread.program_id?._id.toString(),
      decided: 'O',
      application_year: document_thread.application_id.application_year
    });
  }

  res.status(200).send({
    success: true,
    data: document_thread,
    similarThreads:
      is_TaiGer_Admin(user) || is_TaiGer_Agent(user) || is_TaiGer_Editor(user)
        ? similarThreads
        : null,
    agents,
    editors,
    threadAuditLog,
    deadline,
    conflict_list
  });
});

const postImageInThread = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId, studentId }
  } = req;
  const filePath = req.file.key.split('/');
  const fileName = filePath[3];
  let imageurl = new URL(
    `/api/document-threads/image/${messagesThreadId}/${studentId}/${fileName}`,
    ORIGIN
  ).href;
  imageurl = imageurl.replace(/\\/g, '/');
  return res.send({ success: true, data: imageurl });
});

// (O) notification email works
// TODO: need to refactor! using Service layer.
const postMessages = asyncHandler(async (req, res) => {
  const {
    user,
    params: { messagesThreadId }
  } = req;
  const { message } = req.body;

  const document_thread = await DocumentThreadService.getThreadDocByIdPopulated(
    messagesThreadId,
    [['student_id program_id outsourced_user_id']]
  );
  if (!document_thread) {
    logger.info('postMessages: Invalid message thread id');
    throw new ErrorResponse(404, 'Thread Id not found');
  }
  if (document_thread.isFinalVersion) {
    logger.info('postMessages: thread is closed! Please refresh!');
    throw new ErrorResponse(403, ' thread is closed! Please refresh!');
  }
  try {
    JSON.parse(message);
  } catch (e) {
    logger.error(`Thread message collapse ${message}`);
    throw new ErrorResponse(400, 'message collapse');
  }
  // Check student can only access their own thread!!!!
  if (is_TaiGer_Student(user)) {
    if (document_thread.student_id._id.toString() !== user._id.toString()) {
      logger.error('getMessages: Unauthorized request!');
      throw new ErrorResponse(403, 'Unauthorized request');
    }
  }
  const newfile = [];
  if (req.files) {
    for (let i = 0; i < req.files.length; i += 1) {
      const filePath = req.files[i].key.split('/');
      const fileName = filePath[2];

      newfile.push({
        name: fileName,
        path: req.files[i].key
      });
      // Check for duplicate file extensions
      const fileExtensions = (req.files as Express.Multer.File[]).map(
        (file) => file.mimetype.split('/')[1]
      );
      const uniqueFileExtensions = new Set(fileExtensions);
      if (fileExtensions.length !== uniqueFileExtensions.size) {
        logger.error('Error: Duplicate file extensions found!');
        throw new ErrorResponse(
          423,
          'Error: Duplicate file extensions found. Due to the system automatical naming mechanism, the files with same extension (said .pdf) will be overwritten. You can not upload 2 same files extension (2 .pdf or 2 .docx) at the same message. But 1 .pdf and 1 .docx are allowed.'
        );
      }
    }
  }

  const new_message = {
    user_id: user._id,
    message,
    createdAt: new Date(),
    file: newfile
  };
  // TODO: prevent abuse! if document_thread.messages.length > 30, too much message in a thread!
  document_thread.messages.push(new_message);
  document_thread.updatedAt = new Date();
  await document_thread.save();
  const document_thread2 = await DocumentThreadService.findThreadByIdPopulated(
    messagesThreadId,
    [['student_id program_id messages.user_id']]
  );
  // in student (User) collections.
  const student = (await StudentService.getStudentDocByIdPopulated(
    document_thread2.student_id._id.toString(),
    [['editors agents', 'firstname lastname email archiv pictureUrl']]
  )) as unknown as PopulatedStudent | null;
  if (!student) {
    logger.error('postMessages: Invalid student id');
    throw new ErrorResponse(404, 'Student not found');
  }
  const applications = await ApplicationService.findByStudentIdWithProgram(
    document_thread2.student_id._id.toString()
  );

  if (document_thread2.program_id) {
    const application = applications.find(
      ({ programId }) =>
        programId._id.toString() === document_thread2.program_id._id.toString()
    );
    const doc_thread = application.doc_modification_thread.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ doc_thread_id }: any) =>
        doc_thread_id.toString() === document_thread2._id.toString()
    );
    if (doc_thread) {
      if (!is_TaiGer_Student(user)) {
        student.notification.isRead_new_cvmlrl_messsage = false;
      }
      doc_thread.latest_message_left_by_id = user._id.toString();
      doc_thread.updatedAt = new Date();
      await application.save();
    }
  } else {
    const general_thread = student.generaldocs_threads.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ doc_thread_id }: any) =>
        doc_thread_id.toString() === document_thread2._id.toString()
    );
    if (general_thread) {
      if (!is_TaiGer_Student(user)) {
        student.notification.isRead_new_cvmlrl_messsage = false;
      }
      general_thread.latest_message_left_by_id = user._id.toString();
      general_thread.updatedAt = new Date();
    }
  }

  await student.save();
  res.status(200).send({ success: true, data: document_thread2 });

  if (is_TaiGer_Student(user)) {
    if (
      [
        'Supplementary_Form',
        'Curriculum_Analysis',
        'Form_A',
        'Form_B',
        'Others'
      ].includes(document_thread.file_type)
    ) {
      // Inform Agent
      if (isNotArchiv(student)) {
        for (let i = 0; i < student.agents.length; i += 1) {
          // Inform Agent
          if (isNotArchiv(student.agents[i])) {
            const agent_recipent = {
              firstname: student.agents[i].firstname,
              lastname: student.agents[i].lastname,
              address: student.agents[i].email
            };
            const agent_payload: EmailPayload = {
              writer_firstname: user.firstname,
              writer_lastname: user.lastname,
              student_firstname: student.firstname,
              student_lastname: student.lastname,
              uploaded_documentname: document_thread.file_type,
              thread_id: document_thread._id.toString(),
              uploaded_updatedAt: new Date()
            };
            if (document_thread.program_id) {
              // if supplementary form, inform Agent.
              agent_payload.school = document_thread.program_id.school;
              agent_payload.program_name =
                document_thread.program_id.program_name;
              sendNewApplicationMessageInThreadEmail(
                agent_recipent,
                agent_payload
              );
            } else {
              // if supplementary form, inform Agent.
              sendNewGeneraldocMessageInThreadEmail(
                agent_recipent,
                agent_payload
              );
            }
          }
        }
      }
    }

    // If no editor, inform agent and editor lead to assign (Exclude Essay tasks)
    const Editor_Scope = Object.keys(EDITOR_SCOPE);
    if (Editor_Scope.includes(document_thread.file_type)) {
      if (!student.editors || student.editors.length === 0) {
        await StudentService.updateStudentByIdRaw(user._id, {
          needEditor: true
        });
        for (let i = 0; i < student.agents.length; i += 1) {
          // inform active-agent
          if (isNotArchiv(student)) {
            if (isNotArchiv(student.agents[i])) {
              sendAssignEditorReminderEmail(
                {
                  firstname: student.agents[i].firstname,
                  lastname: student.agents[i].lastname,
                  address: student.agents[i].email
                },
                {
                  student_firstname: student.firstname,
                  student_id: student._id.toString(),
                  student_lastname: student.lastname
                }
              );
            }
          }
        }
        // inform editor-lead
        const permissions = await PermissionService.findPermissionsWithUser(
          { canAssignEditors: true },
          'firstname lastname email pictureUrl'
        );
        if (permissions) {
          for (let x = 0; x < permissions.length; x += 1) {
            sendAssignEditorReminderEmail(
              {
                firstname: permissions[x].user_id.firstname,
                lastname: permissions[x].user_id.lastname,
                address: permissions[x].user_id.email
              },
              {
                student_firstname: student.firstname,
                student_id: student._id.toString(),
                student_lastname: student.lastname
              }
            );
          }
        }
      } else {
        // Inform Editor
        for (let i = 0; i < student.editors.length; i += 1) {
          const editor_recipient = {
            firstname: student.editors[i].firstname,
            lastname: student.editors[i].lastname,
            address: student.editors[i].email
          };
          const editor_payload: EmailPayload = {
            writer_firstname: user.firstname,
            writer_lastname: user.lastname,
            student_firstname: student.firstname,
            student_lastname: student.lastname,
            uploaded_documentname: document_thread.file_type,
            thread_id: document_thread._id.toString(),
            uploaded_updatedAt: new Date()
          };
          if (isNotArchiv(student) && isNotArchiv(student.editors[i])) {
            if (document_thread.program_id) {
              editor_payload.school = document_thread.program_id.school;
              editor_payload.program_name =
                document_thread.program_id.program_name;
              sendNewApplicationMessageInThreadEmail(
                editor_recipient,
                editor_payload
              );
            } else {
              sendNewGeneraldocMessageInThreadEmail(
                editor_recipient,
                editor_payload
              );
            }
          }
        }
      }
    }
    // Essay-related only notification: if no essay writer: infor agent and editor lead
    const Essay_Writer_Scope = Object.keys(ESSAY_WRITER_SCOPE);
    if (Essay_Writer_Scope.includes(document_thread.file_type)) {
      if (
        !document_thread.outsourced_user_id ||
        document_thread.outsourced_user_id.length === 0
      ) {
        await StudentService.updateStudentByIdRaw(user._id, {
          needEditor: true
        });
        const payload = {
          student_firstname: student.firstname,
          student_id: student._id.toString(),
          student_lastname: student.lastname
        };
        for (let i = 0; i < student.agents.length; i += 1) {
          // inform active-agent
          if (isNotArchiv(student)) {
            sendAssignEssayWriterReminderEmail(
              {
                firstname: student.agents[i].firstname,
                lastname: student.agents[i].lastname,
                address: student.agents[i].email
              },
              payload
            );
          }
        }
        // inform editor-lead
        const permissions = await PermissionService.findPermissionsWithUser(
          { canAssignEditors: true },
          'firstname lastname email pictureUrl'
        );
        if (permissions) {
          for (let x = 0; x < permissions.length; x += 1) {
            sendAssignEssayWriterReminderEmail(
              {
                firstname: permissions[x].user_id.firstname,
                lastname: permissions[x].user_id.lastname,
                address: permissions[x].user_id.email
              },
              payload
            );
          }
        }
      } else {
        // Inform outsourcer
        for (let i = 0; i < document_thread.outsourced_user_id.length; i += 1) {
          const outsourcer_recipient = {
            firstname: document_thread.outsourced_user_id[i].firstname,
            lastname: document_thread.outsourced_user_id[i].lastname,
            address: document_thread.outsourced_user_id[i].email
          };
          const outsourcer_payload: EmailPayload = {
            writer_firstname: user.firstname,
            writer_lastname: user.lastname,
            student_firstname: student.firstname,
            student_lastname: student.lastname,
            uploaded_documentname: document_thread.file_type,
            thread_id: document_thread._id.toString(),
            uploaded_updatedAt: new Date()
          };
          if (
            isNotArchiv(student) &&
            isNotArchiv(document_thread.outsourced_user_id[i])
          ) {
            if (document_thread.program_id) {
              outsourcer_payload.school = document_thread.program_id.school;
              outsourcer_payload.program_name =
                document_thread.program_id.program_name;
              sendNewApplicationMessageInThreadEmail(
                outsourcer_recipient,
                outsourcer_payload
              );
            } else {
              sendNewGeneraldocMessageInThreadEmail(
                outsourcer_recipient,
                outsourcer_payload
              );
            }
          }
        }
      }
    }
    if (['Interview'].includes(document_thread.file_type)) {
      const interview = await InterviewService.findOneInterview(
        {
          student_id: document_thread.student_id._id.toString(),
          program_id: document_thread.program_id._id.toString()
        },
        [
          ['student_id trainer_id', 'firstname lastname email pictureUrl'],
          ['program_id', 'school program_name degree semester']
        ]
      );

      if (!interview.trainer_id || interview.trainer_id?.length === 0) {
        const permissions = await PermissionService.findPermissionsWithUser(
          { canAssignEditors: true },
          'firstname lastname email pictureUrl'
        );
        if (permissions) {
          for (let x = 0; x < permissions.length; x += 1) {
            sendAssignTrainerReminderEmail(
              {
                firstname: permissions[x].user_id.firstname,
                lastname: permissions[x].user_id.lastname,
                address: permissions[x].user_id.email
              },
              {
                student_firstname: student.firstname,
                student_id: student._id.toString(),
                student_lastname: student.lastname,
                interview_id: interview._id.toString(),
                program: interview.program_id
              }
            );
          }
        }
      } else {
        for (let i = 0; i < interview.trainer_id?.length; i += 1) {
          // inform active-trainer
          if (isNotArchiv(student)) {
            if (isNotArchiv(interview.trainer_id[i])) {
              sendNewInterviewMessageInThreadEmail(
                {
                  firstname: interview.trainer_id[i].firstname,
                  lastname: interview.trainer_id[i].lastname,
                  address: interview.trainer_id[i].email
                },
                {
                  writer_firstname: user.firstname,
                  writer_lastname: user.lastname,
                  student_firstname: interview.student_id.firstname,
                  student_id: student._id.toString(),
                  student_lastname: student.lastname,
                  program: interview.program_id,
                  interview_id: interview._id.toString(),
                  uploaded_updatedAt: new Date()
                }
              );
            }
          }
        }
      }
    }
  }
  if (user.role === Role.Editor) {
    // Inform student
    const student_recipient = {
      firstname: document_thread.student_id.firstname,
      lastname: document_thread.student_id.lastname,
      address: document_thread.student_id.email
    };
    const student_payload: EmailPayload = {
      writer_firstname: user.firstname,
      writer_lastname: user.lastname,
      student_firstname: student.firstname,
      student_lastname: student.lastname,
      uploaded_documentname: document_thread.file_type,
      thread_id: document_thread._id.toString(),
      uploaded_updatedAt: new Date()
    };
    if (isNotArchiv(document_thread.student_id)) {
      if (document_thread.program_id) {
        student_payload.school = document_thread.program_id.school;
        student_payload.program_name = document_thread.program_id.program_name;
        student_payload.program = document_thread.program_id;
        if (['Interview'].includes(document_thread.file_type)) {
          const interview = await InterviewService.findOneInterview(
            {
              student_id: document_thread.student_id._id.toString(),
              program_id: document_thread.program_id._id.toString()
            },
            []
          );
          student_payload.interview_id = interview._id.toString();
          await sendNewInterviewMessageInThreadEmail(
            student_recipient,
            student_payload
          );
        } else {
          await sendNewApplicationMessageInThreadEmail(
            student_recipient,
            student_payload
          );
        }
      } else {
        await sendNewGeneraldocMessageInThreadEmail(
          student_recipient,
          student_payload
        );
      }
    }
  }

  if (is_TaiGer_Agent(user) || user.role === Role.Admin) {
    // Inform Editor
    const Essay_Writer_Scope = Object.keys(ESSAY_WRITER_SCOPE);
    if (Essay_Writer_Scope.includes(document_thread.file_type)) {
      for (let i = 0; i < document_thread.outsourced_user_id.length; i += 1) {
        const recepient = {
          firstname: document_thread.outsourced_user_id[i].firstname,
          lastname: document_thread.outsourced_user_id[i].lastname,
          address: document_thread.outsourced_user_id[i].email
        };
        const emailContent: EmailPayload = {
          writer_firstname: user.firstname,
          writer_lastname: user.lastname,
          student_firstname: student.firstname,
          student_lastname: student.lastname,
          uploaded_documentname: document_thread.file_type,
          thread_id: document_thread._id.toString(),
          uploaded_updatedAt: new Date(),
          message
        };
        if (isNotArchiv(student)) {
          if (isNotArchiv(document_thread.outsourced_user_id[i])) {
            if (document_thread.program_id) {
              emailContent.school = document_thread.program_id.school;
              emailContent.program_name =
                document_thread.program_id.program_name;
              sendNewApplicationMessageInThreadEmail(recepient, emailContent);
            } else {
              sendNewGeneraldocMessageInThreadEmail(recepient, emailContent);
            }
          }
        }
      }
    }

    const Editor_Scope = Object.keys(EDITOR_SCOPE);
    if (Editor_Scope.includes(document_thread.file_type)) {
      for (let i = 0; i < student.editors.length; i += 1) {
        const recipient = {
          firstname: student.editors[i].firstname,
          lastname: student.editors[i].lastname,
          address: student.editors[i].email
        };
        const payload: EmailPayload = {
          writer_firstname: user.firstname,
          writer_lastname: user.lastname,
          student_firstname: student.firstname,
          student_lastname: student.lastname,
          uploaded_documentname: document_thread.file_type,
          thread_id: document_thread._id.toString(),
          uploaded_updatedAt: new Date(),
          message
        };
        if (isNotArchiv(student)) {
          if (isNotArchiv(student.editors[i])) {
            if (document_thread.program_id) {
              payload.school = document_thread.program_id.school;
              payload.program_name = document_thread.program_id.program_name;
              sendNewApplicationMessageInThreadEmail(recipient, payload);
            } else {
              sendNewGeneraldocMessageInThreadEmail(recipient, payload);
            }
          }
        }
      }
    }

    if (['Interview'].includes(document_thread.file_type)) {
      const interview = await InterviewService.findOneInterview(
        {
          student_id: document_thread.student_id._id.toString(),
          program_id: document_thread.program_id._id.toString()
        },
        [
          ['student_id trainer_id', 'firstname lastname email pictureUrl'],
          ['program_id', 'school program_name degree semester']
        ]
      );
      for (let i = 0; i < interview.trainer_id?.length; i += 1) {
        // inform active-trainer
        if (isNotArchiv(student)) {
          if (isNotArchiv(interview.trainer_id[i])) {
            sendNewInterviewMessageInThreadEmail(
              {
                firstname: interview.trainer_id[i].firstname,
                lastname: interview.trainer_id[i].lastname,
                address: interview.trainer_id[i].email
              },
              {
                writer_firstname: user.firstname,
                writer_lastname: user.lastname,
                student_firstname: interview.student_id.firstname,
                student_id: student._id.toString(),
                student_lastname: student.lastname,
                program: interview.program_id,
                interview_id: interview._id.toString(),
                uploaded_updatedAt: new Date()
              }
            );
          }
        }
      }
    }

    // Inform student
    if (isNotArchiv(document_thread.student_id)) {
      const student_recipient = {
        firstname: document_thread.student_id.firstname,
        lastname: document_thread.student_id.lastname,
        address: document_thread.student_id.email
      };
      const student_payload: EmailPayload = {
        writer_firstname: user.firstname,
        writer_lastname: user.lastname,
        student_firstname: student.firstname,
        student_lastname: student.lastname,
        uploaded_documentname: document_thread.file_type,
        thread_id: document_thread._id.toString(),
        uploaded_updatedAt: new Date()
      };
      if (document_thread.program_id) {
        student_payload.school = document_thread.program_id.school;
        student_payload.program_name = document_thread.program_id.program_name;
        student_payload.program = document_thread.program_id;
        if (['Interview'].includes(document_thread.file_type)) {
          const interview = await InterviewService.findOneInterview(
            {
              student_id: document_thread.student_id._id.toString(),
              program_id: document_thread.program_id._id.toString()
            },
            []
          );
          student_payload.interview_id = interview._id.toString();
          sendNewInterviewMessageInThreadEmail(
            student_recipient,
            student_payload
          );
        } else {
          sendNewApplicationMessageInThreadEmail(
            student_recipient,
            student_payload
          );
        }
      } else {
        await sendNewGeneraldocMessageInThreadEmail(
          student_recipient,
          student_payload
        );
      }
    }
  }
});

const getMessageImageDownload = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId, studentId, file_name }
  } = req;

  const fileKey = path
    .join(studentId, messagesThreadId, 'img', file_name)
    .replace(/\\/g, '/');

  const cache_key = `${studentId}${req.originalUrl.split('/')[6]}`;
  const value = ten_minutes_cache.get(cache_key); // image name
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const success = ten_minutes_cache.set(
      cache_key,
      Buffer.from(response as Uint8Array)
    );
    if (success) {
      logger.info('image cache set successfully');
    }
    res.attachment(file_name);
    res.end(response);
  } else {
    logger.info('cache hit');
    res.attachment(file_name);
    return res.end(value);
  }
});

// Download file in a message in a thread
const getMessageFileDownload = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId, messagesThreadId, file_key }
  } = req;

  const document_thread = await DocumentThreadService.getThreadDocById(
    messagesThreadId
  );
  if (!document_thread) {
    logger.error('getMessageFileDownload: thread not found!');
    throw new ErrorResponse(404, 'Thread Id not found');
  }

  if (
    is_TaiGer_Student(user) &&
    document_thread.file_type === 'Essay' &&
    !document_thread.isOriginAuthorDeclarationConfirmedByStudent
  ) {
    logger.error(
      'getMessageFileDownload: Please declare origin author and condition term.'
    );
    throw new ErrorResponse(
      403,
      'Please declare origin author and condition term.'
    );
  }

  // (O) Multitenancy check
  if (
    is_TaiGer_Student(user) &&
    document_thread.student_id.toString() !== user._id.toString()
  ) {
    logger.error('getMessageFileDownload: Not authorized!');
    throw new ErrorResponse(403, 'Not authorized');
  }

  const fileKey = path
    .join(studentId, messagesThreadId, file_key)
    .replace(/\\/g, '/');
  logger.info(
    'Trying to download message file',
    fileKey as unknown as Record<string, unknown>
  );

  // messageid + extension
  const encodedFileName = encodeURIComponent(file_key);
  const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);

  res.attachment(encodedFileName);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodedFileName}`
  );
  return res.end(response);
});

const putOriginAuthorConfirmedByStudent = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId },
    body: { checked }
  } = req;

  const document_thread = await DocumentThreadService.updateThreadById(
    messagesThreadId,
    {
      isOriginAuthorDeclarationConfirmedByStudent: checked,
      isOriginAuthorDeclarationConfirmedByStudentTimestamp: new Date()
    }
  );

  if (!document_thread) {
    logger.error(
      'putOriginAuthorConfirmedByStudent: Invalid message thread id'
    );
    throw new ErrorResponse(404, 'Thread Id not found');
  }

  res.status(200).send({
    success: true
  });
});

// (O) notification student email works
// (O) notification agent email works
const SetStatusMessagesThread = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { messagesThreadId, studentId },
    body: { application_id }
  } = req;

  const document_thread = await DocumentThreadService.getThreadDocById(
    messagesThreadId
  );
  const student = (await StudentService.getStudentById(
    studentId
  )) as unknown as PopulatedStudent | null;
  if (!document_thread) {
    logger.error('SetStatusMessagesThread: Invalid message thread id');
    throw new ErrorResponse(404, 'Thread not found');
  }
  if (!student) {
    logger.error('SetStatusMessagesThread: Invalid student id');
    throw new ErrorResponse(404, 'Student not found');
  }

  let isFinalVersionBefore;
  let isFinalVersionAfter;

  if (application_id) {
    const student_application = await ApplicationService.getApplicationById(
      application_id
    );
    if (!student_application) {
      logger.error('SetStatusMessagesThread: application not found');
      throw new ErrorResponse(404, 'Application not found');
    }

    const application_thread = student_application.doc_modification_thread.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (thread: any) => thread.doc_thread_id._id.toString() === messagesThreadId
    );
    if (!application_thread) {
      logger.error('SetStatusMessagesThread: application thread not found');
      throw new ErrorResponse(404, 'Thread not found');
    }
    isFinalVersionBefore = application_thread.isFinalVersion;
    application_thread.isFinalVersion = !isFinalVersionBefore;
    application_thread.updatedAt = new Date();
    document_thread.isFinalVersion = !isFinalVersionBefore;
    isFinalVersionAfter = application_thread.isFinalVersion;
    document_thread.updatedAt = new Date();
    await student_application.save();
    await document_thread.save();

    res.status(200).send({
      success: true,
      data: {
        isFinalVersion: document_thread.isFinalVersion,
        updatedAt: document_thread.updatedAt
      }
    });
    if (document_thread.isFinalVersion) {
      // cleanup
      logger.info('cleanup program thread');
      const collection = 'Documentthread';
      const userFolder = 'student_id';
      try {
        await threadS3GarbageCollector(
          req,
          collection,
          userFolder,
          messagesThreadId
        );
      } catch (error) {
        const err = error as { message?: string; stack?: string };
        logger.error('Failed to cleanup program thread files:', {
          error: err?.message,
          stack: err?.stack,
          threadId: messagesThreadId,
          studentId,
          applicationId: application_id,
          fileType: document_thread.file_type
        });
        // Don't throw the error to avoid breaking the main flow
      }
    }
    if (isNotArchiv(student)) {
      await sendSetAsFinalProgramSpecificFileForStudentEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        {
          editor_firstname: user.firstname,
          editor_lastname: user.lastname,
          school: student_application.programId.school,
          program_name: student_application.programId.program_name,
          uploaded_documentname: application_thread.doc_thread_id.file_type,
          uploaded_updatedAt: new Date(),
          thread_id: messagesThreadId,
          isFinalVersion: application_thread.isFinalVersion
        }
      );
    }

    // student existence already validated above (same studentId); cast the
    // populated read to its consumed shape.
    const student3 = (await StudentService.getStudentByIdPopulated(studentId, [
      ['agents', 'firstname lastname email archiv']
    ])) as unknown as PopulatedStudent;

    const validAgents = student3.agents.filter(
      (agent) => isNotArchiv(student3) && isNotArchiv(agent)
    );
    // Create an array of promises for sending emails
    const emailPromises = validAgents.map((agent) =>
      sendSetAsFinalProgramSpecificFileForAgentEmail(
        {
          firstname: agent.firstname,
          lastname: agent.lastname,
          address: agent.email
        },
        {
          student_firstname: student3.firstname,
          student_lastname: student3.lastname,
          editor_firstname: user.firstname,
          editor_lastname: user.lastname,
          school: student_application.programId.school,
          program_name: student_application.programId.program_name,
          uploaded_documentname: application_thread.doc_thread_id.file_type,
          uploaded_updatedAt: new Date(),
          thread_id: messagesThreadId,
          isFinalVersion: application_thread.isFinalVersion
        }
      )
    );

    // Wait for all email promises to be resolved
    await Promise.all(emailPromises);
  } else {
    isFinalVersionBefore = document_thread.isFinalVersion;
    await StudentService.updateStudentByFilter(
      { _id: studentId, 'generaldocs_threads.doc_thread_id': messagesThreadId },
      {
        'generaldocs_threads.$.isFinalVersion': !isFinalVersionBefore,
        'generaldocs_threads.$.updatedAt': new Date()
      }
    );
    document_thread.isFinalVersion = !isFinalVersionBefore;
    isFinalVersionAfter = document_thread.isFinalVersion;
    document_thread.updatedAt = new Date();
    await document_thread.save();

    res.status(200).send({
      success: true,
      data: {
        isFinalVersion: document_thread.isFinalVersion,
        updatedAt: document_thread.updatedAt
      }
    });
    if (document_thread.isFinalVersion) {
      // cleanup
      logger.info('cleanup cv');
      const collection = 'Documentthread';
      const userFolder = 'student_id';
      try {
        await threadS3GarbageCollector(
          req,
          collection,
          userFolder,
          messagesThreadId
        );
      } catch (error) {
        const err = error as { message?: string; stack?: string };
        logger.error('Failed to cleanup CV thread files:', {
          error: err?.message,
          stack: err?.stack,
          threadId: messagesThreadId,
          studentId,
          fileType: document_thread.file_type
        });
        // Don't throw the error to avoid breaking the main flow
      }
    }
    if (isNotArchiv(student)) {
      await sendSetAsFinalGeneralFileForStudentEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        {
          editor_firstname: user.firstname,
          editor_lastname: user.lastname,
          uploaded_documentname: document_thread.file_type,
          uploaded_updatedAt: new Date(),
          thread_id: document_thread._id?.toString(),
          isFinalVersion: document_thread.isFinalVersion
        }
      );
    }

    const student3 = (await StudentService.getStudentByIdPopulated(studentId, [
      ['agents', 'firstname lastname email archiv']
    ])) as unknown as PopulatedStudent;

    for (let i = 0; i < student.agents.length; i += 1) {
      if (isNotArchiv(student3)) {
        if (isNotArchiv(student3.agents[i])) {
          await sendSetAsFinalGeneralFileForAgentEmail(
            {
              firstname: student3.agents[i].firstname,
              lastname: student3.agents[i].lastname,
              address: student3.agents[i].email
            },
            {
              student_firstname: student3.firstname,
              student_lastname: student3.lastname,
              student_id: student3._id.toString(),
              editor_firstname: user.firstname,
              editor_lastname: user.lastname,
              thread_id: document_thread._id?.toString(),
              uploaded_documentname: document_thread.file_type,
              uploaded_updatedAt: new Date(),
              isFinalVersion: document_thread.isFinalVersion
            }
          );
        }
      }
    }
  }

  req.audit = {
    performedBy: user._id,
    targetUserId: student._id, // Change this if you have a different target user ID
    targetDocumentThreadId: messagesThreadId,
    action: 'update', // Action performed
    field: 'status', // Field that was updated (if applicable)
    changes: {
      before: isFinalVersionBefore, // Before state
      after: isFinalVersionAfter
    }
  };

  next();
});

const deleteGeneralThread = asyncHandler(async (req, studentId, threadId) => {
  // Delete folder
  let directory = path.join(studentId, threadId);
  logger.info('Trying to delete message thread and folder');
  directory = directory.replace(/\\/g, '/');

  await emptyS3Directory(AWS_S3_BUCKET_NAME, directory);

  // The legacy session was never attached to these writes, so the effective
  // behaviour is two sequential writes.
  try {
    await DocumentThreadService.deleteThreadById(threadId);
    await StudentService.updateStudentByIdRaw(studentId, {
      $pull: {
        generaldocs_threads: { doc_thread_id: { _id: threadId } }
      }
    });
  } catch (error) {
    logger.error(
      'Failed to delete message thread and folder',
      error as Record<string, unknown>
    );
    throw error;
  }
});

// () TODO email : notification
const handleDeleteGeneralThread = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId, studentId }
  } = req;

  const to_be_delete_thread = await DocumentThreadService.getThreadDocById(
    messagesThreadId
  );
  const student = await StudentService.getStudentDocById(studentId);

  if (!to_be_delete_thread) {
    logger.error('handleDeleteGeneralThread: Invalid message thread id');
    throw new ErrorResponse(404, 'Message not found');
  }
  if (!student) {
    logger.error('handleDeleteGeneralThread: Invalid student id id');
    throw new ErrorResponse(404, 'Student not found');
  }

  await deleteGeneralThread(req, studentId, messagesThreadId);
  res.status(200).send({ success: true });
});

// (-) TODO email : notification
const handleDeleteProgramThread = asyncHandler(async (req, res) => {
  const {
    params: { messagesThreadId, application_id, studentId }
  } = req;

  const to_be_delete_thread = await DocumentThreadService.getThreadDocById(
    messagesThreadId
  );
  if (!to_be_delete_thread) {
    logger.error('handleDeleteProgramThread: Invalid message thread id!');
    throw new ErrorResponse(404, 'Message not found');
  }

  const student = await StudentService.getStudentDocById(studentId);
  if (!student) {
    logger.error('handleDeleteProgramThread: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }

  // Before delete the thread, please delete all of the files in the thread!!
  // Delete folder
  let directory = path.join(studentId, messagesThreadId);
  logger.info('Trying to delete message thread and folder');
  directory = directory.replace(/\\/g, '/');
  emptyS3Directory(AWS_S3_BUCKET_NAME, directory);

  await ApplicationService.pullDocModificationThread(
    application_id,
    messagesThreadId
  );
  const thread = await DocumentThreadService.deleteThreadById(messagesThreadId);
  await SurveyInputService.deleteSurveyInput({
    studentId,
    programId: new mongoose.Types.ObjectId(to_be_delete_thread.program_id),
    fileType: thread.file_type
  });
  res.status(200).send({ success: true });
});

// (-) TODO email : no notification needed
const deleteAMessageInThread = asyncHandler(async (req, res) => {
  const {
    user,
    params: { messagesThreadId, messageId }
  } = req;

  const thread = (await DocumentThreadService.getThreadDocById(
    messagesThreadId
  )) as unknown as PopulatedThread | null;
  if (!thread) {
    logger.error('deleteAMessageInThread : Invalid message thread id');
    throw new ErrorResponse(404, 'Thread not found');
  }
  if (thread.isFinalVersion) {
    logger.error('deleteAMessageInThread : FinalVersion is read only');
    throw new ErrorResponse(423, 'FinalVersion is read only');
  }
  const msg = thread.messages.find(
    (message) => message._id.toString() === messageId
  );

  if (!msg) {
    logger.error('deleteAMessageInThread : Invalid message id');
    throw new ErrorResponse(404, 'Message not found');
  }
  // Prevent multitenant
  if (
    msg.user_id?.toString() !== user._id.toString() &&
    !is_TaiGer_Admin(user)
  ) {
    logger.error(
      'deleteAMessageInThread : You can only delete your own message.'
    );
    throw new ErrorResponse(409, 'You can only delete your own message.');
  }

  // Messageid + extension (because extension is unique per message id)
  const msgFiles = msg.file ?? [];
  try {
    if (msgFiles.filter((file) => file.path !== '')?.length > 0) {
      await deleteS3Objects({
        bucketName: AWS_S3_BUCKET_NAME,
        objectKeys: msgFiles
          .filter((file) => file.path !== '')
          .map((file) => ({ Key: file.path }))
      });
    }
  } catch (err) {
    if (err) {
      logger.error('delete thread files: ', err as Record<string, unknown>);
      throw new ErrorResponse(500, 'Error occurs while deleting thread files');
    }
  }

  for (let i = 0; i < msgFiles.length; i += 1) {
    const cache_key = `${encodeURIComponent(msgFiles[i].path)}`;
    const value = ten_minutes_cache.del(cache_key);
    if (value === 1) {
      logger.info('file cache key deleted successfully');
    }
  }
  // Don't need so delete in S3 , will delete by garbage collector
  await DocumentThreadService.updateThreadById(messagesThreadId, {
    $pull: {
      messages: { _id: messageId }
    }
  });

  res.status(200).send({ success: true });

  // update latest_message_left_by_id
  const updated_thread = await DocumentThreadService.getThreadDocById(
    messagesThreadId
  );

  const studentIdRaw = thread.student_id as unknown as string;
  const student = (await StudentService.getStudentDocById(
    studentIdRaw
  )) as unknown as PopulatedStudent | null;
  const applications = await ApplicationService.findByStudentIdLean(
    studentIdRaw
  );

  const application = applications.find((app) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.doc_modification_thread.some(
      (thr: any) => thr.doc_thread_id.toString() === messagesThreadId
    )
  );

  const t = !application
    ? student?.generaldocs_threads.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tt: any) => tt.doc_thread_id.toString() === messagesThreadId
      )
    : application.doc_modification_thread.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tt: any) => tt.doc_thread_id.toString() === messagesThreadId
      );
  if (t) {
    if (updated_thread && updated_thread.messages.length > 0) {
      t.latest_message_left_by_id =
        updated_thread.messages[
          updated_thread.messages.length - 1
        ].user_id.toString();
      t.updatedAt =
        updated_thread.messages[updated_thread.messages.length - 1].updatedAt;
    } else {
      t.latest_message_left_by_id = '';
    }
  }
  await t?.save();
});

const assignEssayWritersToEssayTask = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { messagesThreadId },
    body: editorsId
  } = req;

  // Data validation
  if (!messagesThreadId || !editorsId || typeof editorsId !== 'object') {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid input data.' });
  }

  const essayDocumentThreads = (await DocumentThreadService.getThreadById(
    messagesThreadId
  )) as PopulatedThread | null;

  if (!essayDocumentThreads) {
    return res
      .status(404)
      .json({ success: false, message: 'Essay thread not found.' });
  }

  const {
    addedUsers: addedEditors,
    removedUsers: removedEditors,
    updatedUsers: updatedEditors,
    toBeInformedUsers: toBeInformedEditors,
    updatedUserIds: updatedEditorIds
  } = await userChangesHelperFunction(
    editorsId,
    essayDocumentThreads.outsourced_user_id
  );

  // Update student's thread essay writers
  if (addedEditors.length > 0 || removedEditors.length > 0) {
    // Log the changes here
    logger.info('Essay Writer updated:', {
      added: addedEditors,
      removed: removedEditors
    });
    await DocumentThreadService.updateThreadById(messagesThreadId, {
      outsourced_user_id: updatedEditorIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      )
    });
  }

  const studentId = essayDocumentThreads.student_id;
  const student_upated = (await StudentService.getStudentById(
    studentId as unknown as string
  )) as unknown as PopulatedStudent;

  const essayDocumentThreads_Updated =
    await DocumentThreadService.getThreadById(messagesThreadId);

  res.status(200).send({ success: true, data: essayDocumentThreads_Updated });

  for (let i = 0; i < toBeInformedEditors.length; i += 1) {
    if (isNotArchiv(student_upated)) {
      if (isNotArchiv(toBeInformedEditors[i] as unknown as IUser)) {
        await informEssayWriterNewEssayEmail(
          {
            firstname: toBeInformedEditors[i].firstname,
            lastname: toBeInformedEditors[i].lastname,
            address: toBeInformedEditors[i].email
          },
          {
            std_firstname: student_upated.firstname,
            std_lastname: student_upated.lastname,
            std_id: student_upated._id.toString(),
            thread_id: essayDocumentThreads._id.toString(),
            file_type: essayDocumentThreads.file_type,
            program: essayDocumentThreads.program_id
          }
        );
      }
    }
  }
  // TODO: inform Agent for assigning editor.
  for (let i = 0; i < student_upated.agents.length; i += 1) {
    if (isNotArchiv(student_upated)) {
      if (isNotArchiv(student_upated.agents[i])) {
        await informAgentEssayAssignedEmail(
          {
            firstname: student_upated.agents[i].firstname,
            lastname: student_upated.agents[i].lastname,
            address: student_upated.agents[i].email
          },
          {
            std_firstname: student_upated.firstname,
            std_lastname: student_upated.lastname,
            std_id: student_upated._id.toString(),
            thread_id: essayDocumentThreads._id.toString(),
            file_type: essayDocumentThreads.file_type,
            essay_writers: toBeInformedEditors,
            program: essayDocumentThreads.program_id
          }
        );
      }
    }
  }

  if (updatedEditors.length !== 0) {
    if (isNotArchiv(student_upated)) {
      await informStudentTheirEssayWriterEmail(
        {
          firstname: student_upated.firstname,
          lastname: student_upated.lastname,
          address: student_upated.email
        },
        {
          program: essayDocumentThreads.program_id,
          thread_id: essayDocumentThreads._id.toString(),
          file_type: essayDocumentThreads.file_type,
          editors: updatedEditors
        }
      );
    }
  }

  req.audit = {
    performedBy: user._id,
    targetUserId: student_upated._id, // Change this if you have a different target user ID
    targetDocumentThreadId: messagesThreadId,
    action: 'update', // Action performed
    field: 'essay writer', // Field that was updated (if applicable)
    changes: {
      before: essayDocumentThreads.outsourced_user_id, // Before state
      after: {
        added: addedEditors,
        removed: removedEditors
      }
    }
  };

  next();
});

const clearEssayWriters = asyncHandler(async (req, res) => {
  await DocumentThreadService.clearAllOutsourcedUsers();
  res.status(200).send({ success: true });
});

const IgnoreMessageInDocumentThread = asyncHandler(async (req, res) => {
  const {
    params: { messageId, ignoreMessageState }
  } = req;
  const thread = await DocumentThreadService.setMessageIgnore(
    new mongoose.Types.ObjectId(messageId) as unknown as string,
    ignoreMessageState
  );
  res.status(200).send({ success: true, data: thread });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getActiveThreadsByStudent = (student: any) => [
  ...(student.applications
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((app: any) => isProgramDecided(app))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .flatMap((app: any) => app.doc_modification_thread) || []),
  ...(student.generaldocs_threads || [])
];

const getThreadsByStudent = asyncHandler(async (req, res) => {
  const { studentId } = req.params;

  const threads = await DocumentThreadService.getStudentThreadsByStudentId(
    studentId
  );
  res.status(200).send({
    success: true,
    data: { threads }
  });
});

const getMyStudentMetrics = asyncHandler(async (req, res) => {
  const students = await StudentService.getStudentsWithApplications({
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  });

  const studentsWithCount = students.map((student) => {
    const studentId = String(student._id);
    const threads = getActiveThreadsByStudent(student);

    student.threads = threads
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.sort(
        (a: any, b: any) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.map((thread: any) => thread?.doc_thread_id?._id);
    student.threadCount = threads.length;
    student.completeThreadCount = threads.filter(
      (thread) => thread.doc_thread_id?.isFinalVersion
    ).length;

    student.needToReply = threads.some((thread) => {
      const lastMessage = thread.doc_thread_id?.messages?.[0];
      return (
        lastMessage?.user_id?._id?.toString() === studentId &&
        !thread.isFinalVersion
      );
    });

    return student;
  });

  res.status(200).send({
    success: true,
    data: {
      students: studentsWithCount
    }
  });
});

// Forward a student's documents (base "My Documents" + latest CV/ML/RL files)
// by email to other TaiGer staff. Authorization (requester may access this
// student) is enforced by the route middleware (multitenant_filter +
// chatMultitenantFilter); recipient emails are resolved from ids server-side.
const forwardStudentDocuments = asyncHandler(async (req, res) => {
  const {
    params: { studentId },
    body: {
      recipientIds,
      ccIds,
      bccIds,
      threadIds,
      baseDocumentNames,
      subject,
      message,
      confirmMissing
    }
  } = req;

  const result = await ForwardDocumentsService.forwardStudentDocuments({
    studentId,
    recipientIds,
    ccIds,
    bccIds,
    threadIds,
    baseDocumentNames,
    subject,
    message,
    confirmMissing
  });

  res.status(200).send({ success: true, data: result });
});

export = {
  getActiveThreads,
  getActiveThreadsPaginated,
  getActiveThreadsCounts,
  getMyStudentsThreadsPaginated,
  getMyStudentsThreadsCounts,
  getMyStudentsThreads,
  getSurveyInputs,
  postSurveyInput,
  putSurveyInput,
  initGeneralMessagesThread,
  initApplicationMessagesThread,
  getMessages,
  getMyStudentMetrics,
  getThreadsByStudent,
  getMessageImageDownload,
  getMessageFileDownload,
  postImageInThread,
  postMessages,
  putThreadFavorite,
  putOriginAuthorConfirmedByStudent,
  checkDocumentPattern,
  SetStatusMessagesThread,
  handleDeleteGeneralThread,
  handleDeleteProgramThread,
  deleteAMessageInThread,
  assignEssayWritersToEssayTask,
  clearEssayWriters,
  IgnoreMessageInDocumentThread,
  forwardStudentDocuments
};
