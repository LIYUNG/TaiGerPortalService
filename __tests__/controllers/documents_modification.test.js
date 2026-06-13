// Controller UNIT test for controllers/documents_modification (survey-input,
// overview and metadata handlers).
//
// documents_modification is a large, tangled controller: a single handler can
// fan out to several services (DocumentThread/Student/SurveyInput/User/...) plus
// S3, node-cache, email and the informEditor side channel. We call each handler
// DIRECTLY as a (req, res, next) function with ALL of those modules mocked, and
// assert ONLY the controller's own work: the args it forwards, the status + body
// it writes, and the small bits of branching/counting it owns. No route, no
// supertest, no DB, nothing real runs below the controller.
//
// This file focuses on the CRUD / overview / survey-input handlers; the
// message-thread handlers (getMessages, favorite, deletes, ...) are unit-tested
// in __tests__/controllers/documentthread.test.js. Full route -> service -> dao
// -> in-memory Mongo wiring lives in the matching integration suites.

jest.mock('../../services/documentthreads');
jest.mock('../../services/students');
jest.mock('../../services/surveyInputs');
jest.mock('../../services/users');
jest.mock('../../services/applications');
jest.mock('../../services/permissions');
jest.mock('../../services/interviews');
jest.mock('../../services/audit');
jest.mock('../../utils/informEditor', () => ({
  informOnSurveyUpdate: jest.fn().mockResolvedValue({})
}));
jest.mock('../../services/email', () => ({
  sendNewApplicationMessageInThreadEmail: jest.fn(),
  sendAssignEditorReminderEmail: jest.fn(),
  sendNewGeneraldocMessageInThreadEmail: jest.fn(),
  sendSetAsFinalGeneralFileForAgentEmail: jest.fn(),
  sendSetAsFinalGeneralFileForStudentEmail: jest.fn(),
  sendSetAsFinalProgramSpecificFileForStudentEmail: jest.fn(),
  sendSetAsFinalProgramSpecificFileForAgentEmail: jest.fn(),
  assignDocumentTaskToEditorEmail: jest.fn(),
  assignDocumentTaskToStudentEmail: jest.fn(),
  sendAssignEssayWriterReminderEmail: jest.fn(),
  assignEssayTaskToEditorEmail: jest.fn(),
  sendAssignTrainerReminderEmail: jest.fn(),
  sendNewInterviewMessageInThreadEmail: jest.fn(),
  informEssayWriterNewEssayEmail: jest.fn(),
  informStudentTheirEssayWriterEmail: jest.fn(),
  informAgentEssayAssignedEmail: jest.fn()
}));
jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn().mockResolvedValue(Buffer.from('bytes')),
  deleteS3Objects: jest.fn().mockResolvedValue({})
}));
jest.mock('../../utils/modelHelper/versionControl', () => ({
  ...jest.requireActual('../../utils/modelHelper/versionControl'),
  emptyS3Directory: jest.fn().mockResolvedValue({})
}));
jest.mock('../../utils/utils_function', () => ({
  threadS3GarbageCollector: jest.fn().mockResolvedValue({}),
  patternMatched: jest.fn().mockResolvedValue(false),
  userChangesHelperFunction: jest.fn()
}));
jest.mock('../../utils/queryFunctions', () => ({
  getPermission: jest.fn().mockResolvedValue({})
}));
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn().mockReturnValue(true),
    del: jest.fn().mockReturnValue(1),
    flushAll: jest.fn()
  }
}));

const { ObjectId } = require('mongoose').Types;
const DocumentThreadService = require('../../services/documentthreads');
const StudentService = require('../../services/students');
const SurveyInputService = require('../../services/surveyInputs');
const UserService = require('../../services/users');
const ApplicationService = require('../../services/applications');
const PermissionService = require('../../services/permissions');
const InterviewService = require('../../services/interviews');
const AuditService = require('../../services/audit');
const { informOnSurveyUpdate } = require('../../utils/informEditor');
const { userChangesHelperFunction } = require('../../utils/utils_function');
const {
  getActiveThreads,
  getActiveThreadsPaginated,
  getActiveThreadsCounts,
  getMyStudentsThreadsPaginated,
  getMyStudentsThreadsCounts,
  getMyStudentsThreads,
  getThreadsByStudent,
  getSurveyInputs,
  getMessages,
  postMessages,
  putThreadFavorite,
  deleteAMessageInThread,
  postSurveyInput,
  putSurveyInput,
  initGeneralMessagesThread,
  initApplicationMessagesThread,
  postImageInThread,
  getMessageImageDownload,
  getMessageFileDownload,
  putOriginAuthorConfirmedByStudent,
  SetStatusMessagesThread,
  handleDeleteGeneralThread,
  handleDeleteProgramThread,
  assignEssayWritersToEssayTask,
  IgnoreMessageInDocumentThread,
  getMyStudentMetrics,
  checkDocumentPattern,
  clearEssayWriters
} = require('../../controllers/documents_modification');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getActiveThreads', () => {
  it('200: forwards the built filter to the service and returns the threads', async () => {
    const threads = [{ _id: 't1' }, { _id: 't2' }];
    DocumentThreadService.getAllStudentsThreads.mockResolvedValue(threads);
    const res = mockRes();

    await getActiveThreads(mockReq({ query: {} }), res, jest.fn());

    expect(DocumentThreadService.getAllStudentsThreads).toHaveBeenCalledTimes(
      1
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: threads });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    DocumentThreadService.getAllStudentsThreads.mockRejectedValue(err);
    const next = jest.fn();

    await getActiveThreads(mockReq({ query: {} }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getMyStudentsThreads', () => {
  it('200: returns { threads, user }, forwarding userId to both services', async () => {
    const userId = new ObjectId().toHexString();
    const threads = [{ _id: 't1' }];
    const user = { _id: userId, firstname: 'A' };
    DocumentThreadService.getStudentsThreadsByTaiGerUserId.mockResolvedValue(
      threads
    );
    UserService.getUserById.mockResolvedValue(user);
    const res = mockRes();

    await getMyStudentsThreads(
      mockReq({ params: { userId }, query: {} }),
      res,
      jest.fn()
    );

    expect(
      DocumentThreadService.getStudentsThreadsByTaiGerUserId
    ).toHaveBeenCalledWith(userId, expect.any(Object));
    expect(UserService.getUserById).toHaveBeenCalledWith(userId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { threads, user }
    });
  });
});

describe('getThreadsByStudent', () => {
  it('200: forwards req.params.studentId and wraps the threads', async () => {
    const threads = [{ _id: 't1' }];
    DocumentThreadService.getStudentThreadsByStudentId.mockResolvedValue(
      threads
    );
    const res = mockRes();

    await getThreadsByStudent(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(
      DocumentThreadService.getStudentThreadsByStudentId
    ).toHaveBeenCalledWith(studentId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { threads }
    });
  });
});

describe('postSurveyInput', () => {
  it('200: creates the survey input from req.body.input (createdAt stamped)', async () => {
    const created = { _id: 's1', studentId, fileType: 'RL' };
    SurveyInputService.createSurveyInput.mockResolvedValue(created);
    const res = mockRes();

    await postSurveyInput(
      mockReq({
        user: admin,
        body: { input: { studentId, fileType: 'RL' }, informEditor: false }
      }),
      res,
      jest.fn()
    );

    const arg = SurveyInputService.createSurveyInput.mock.calls[0][0];
    expect(arg).toMatchObject({ studentId, fileType: 'RL' });
    expect(arg.createdAt).toBeInstanceOf(Date);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
    // informEditor false -> no editor notification
    expect(informOnSurveyUpdate).not.toHaveBeenCalled();
  });

  it('informEditor true: notifies the editor after responding', async () => {
    const created = { _id: 's1', studentId, programId: null, fileType: 'RL' };
    SurveyInputService.createSurveyInput.mockResolvedValue(created);
    DocumentThreadService.findOneThreadPopulated.mockResolvedValue({
      _id: 't'
    });
    const res = mockRes();

    await postSurveyInput(
      mockReq({
        user: admin,
        body: { input: { studentId, fileType: 'RL' }, informEditor: true }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(informOnSurveyUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('putSurveyInput', () => {
  it('200: updates by surveyInputId and stamps updatedAt', async () => {
    const surveyInputId = new ObjectId().toHexString();
    const updated = { _id: surveyInputId, studentId };
    SurveyInputService.updateSurveyInputById.mockResolvedValue(updated);
    const res = mockRes();

    await putSurveyInput(
      mockReq({
        user: admin,
        params: { surveyInputId },
        body: { input: { surveyStatus: 'completed' }, informEditor: false }
      }),
      res,
      jest.fn()
    );

    expect(SurveyInputService.updateSurveyInputById).toHaveBeenCalledWith(
      surveyInputId,
      expect.objectContaining({
        surveyStatus: 'completed',
        updatedAt: expect.any(Date)
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });
});

describe('putOriginAuthorConfirmedByStudent', () => {
  it('200: updates the thread confirmation flag and responds success', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.updateThreadById.mockResolvedValue({
      _id: messagesThreadId
    });
    const res = mockRes();

    await putOriginAuthorConfirmedByStudent(
      mockReq({ params: { messagesThreadId }, body: { checked: true } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      messagesThreadId,
      expect.objectContaining({
        isOriginAuthorDeclarationConfirmedByStudent: true
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse to next() when the thread is missing', async () => {
    DocumentThreadService.updateThreadById.mockResolvedValue(null);
    const next = jest.fn();

    await putOriginAuthorConfirmedByStudent(
      mockReq({
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: { checked: true }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('IgnoreMessageInDocumentThread', () => {
  it('200: sets the ignore state and returns the updated thread', async () => {
    const messageId = new ObjectId().toHexString();
    const thread = { _id: 't1' };
    DocumentThreadService.setMessageIgnore.mockResolvedValue(thread);
    const res = mockRes();

    await IgnoreMessageInDocumentThread(
      mockReq({ params: { messageId, ignoreMessageState: 'true' } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.setMessageIgnore).toHaveBeenCalledWith(
      expect.any(ObjectId),
      'true'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: thread });
  });
});

describe('getMyStudentMetrics', () => {
  it('200: returns per-student thread counts derived from the service data', async () => {
    const students = [
      {
        _id: studentId,
        applications: [],
        generaldocs_threads: [
          {
            doc_thread_id: { _id: 'th1', isFinalVersion: true },
            updatedAt: new Date()
          },
          {
            doc_thread_id: { _id: 'th2', isFinalVersion: false },
            updatedAt: new Date()
          }
        ]
      }
    ];
    StudentService.getStudentsWithApplications.mockResolvedValue(students);
    const res = mockRes();

    await getMyStudentMetrics(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.students).toHaveLength(1);
    expect(body.data.students[0].threadCount).toBe(2);
    expect(body.data.students[0].completeThreadCount).toBe(1);
  });
});

describe('checkDocumentPattern', () => {
  it('200 isPassed:true for a non-CV file type (short-circuits, no S3)', async () => {
    const res = mockRes();

    await checkDocumentPattern(
      mockReq({
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          file_type: 'ML'
        }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, isPassed: true });
  });
});

describe('clearEssayWriters', () => {
  it('200: clears all outsourced users and responds success', async () => {
    DocumentThreadService.clearAllOutsourcedUsers.mockResolvedValue({});
    const res = mockRes();

    await clearEssayWriters(mockReq(), res, jest.fn());

    expect(DocumentThreadService.clearAllOutsourcedUsers).toHaveBeenCalledTimes(
      1
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});

describe('getActiveThreadsPaginated', () => {
  it('200: fetches active students then forwards their ids to the service', async () => {
    StudentService.fetchSimpleStudents.mockResolvedValue([
      { _id: new ObjectId() }
    ]);
    DocumentThreadService.getActiveThreadsPaginated.mockResolvedValue({
      data: [],
      total: 0
    });
    const res = mockRes();

    await getActiveThreadsPaginated(mockReq({ query: {} }), res, jest.fn());

    expect(
      DocumentThreadService.getActiveThreadsPaginated
    ).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].success).toBe(true);
  });
});

describe('getActiveThreadsCounts', () => {
  it('200: forwards the active student ids to the counts service', async () => {
    StudentService.fetchSimpleStudents.mockResolvedValue([
      { _id: new ObjectId() }
    ]);
    DocumentThreadService.getActiveThreadsCounts.mockResolvedValue({ all: 3 });
    const res = mockRes();

    await getActiveThreadsCounts(mockReq({ query: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: { all: 3 } });
  });
});

describe('getMyStudentsThreadsPaginated', () => {
  it('200: scopes to the supervised students and outsourced user', async () => {
    const userId = new ObjectId().toHexString();
    StudentService.fetchSimpleStudents.mockResolvedValue([
      { _id: new ObjectId() }
    ]);
    DocumentThreadService.getActiveThreadsPaginated.mockResolvedValue({
      data: []
    });
    const res = mockRes();

    await getMyStudentsThreadsPaginated(
      mockReq({ params: { userId }, query: {} }),
      res,
      jest.fn()
    );

    const arg =
      DocumentThreadService.getActiveThreadsPaginated.mock.calls[0][0];
    expect(arg.outsourcedUserId).toBe(userId);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getMyStudentsThreadsCounts', () => {
  it('200: scopes the counts to the supervised students', async () => {
    const userId = new ObjectId().toHexString();
    StudentService.fetchSimpleStudents.mockResolvedValue([]);
    DocumentThreadService.getActiveThreadsCounts.mockResolvedValue({ all: 0 });
    const res = mockRes();

    await getMyStudentsThreadsCounts(
      mockReq({ params: { userId }, query: {} }),
      res,
      jest.fn()
    );

    const arg = DocumentThreadService.getActiveThreadsCounts.mock.calls[0][0];
    expect(arg.outsourcedUserId).toBe(userId);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getSurveyInputs (not found guard)', () => {
  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadById.mockResolvedValue(null);
    const next = jest.fn();

    await getSurveyInputs(
      mockReq({ params: { messagesThreadId: new ObjectId().toHexString() } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('postImageInThread', () => {
  it('200: builds an image url from the uploaded file key', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const res = mockRes();

    await postImageInThread(
      mockReq({
        params: { messagesThreadId, studentId },
        file: { key: `${studentId}/${messagesThreadId}/img/pic.png` }
      }),
      res,
      jest.fn()
    );

    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toContain('pic.png');
  });
});

describe('getMessageImageDownload', () => {
  it('cache miss: fetches from S3, caches, and streams the attachment', async () => {
    const { getS3Object } = require('../../aws/s3');
    getS3Object.mockResolvedValue(Buffer.from('img'));
    const messagesThreadId = new ObjectId().toHexString();
    const res = mockRes();
    // mockRes() has no attachment/setHeader; the download handlers use both.
    res.attachment = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);

    await getMessageImageDownload(
      mockReq({
        params: { messagesThreadId, studentId, file_name: 'pic.png' },
        originalUrl: `/api/x/y/z/a/b/${messagesThreadId}`
      }),
      res,
      jest.fn()
    );

    expect(getS3Object).toHaveBeenCalled();
    expect(res.attachment).toHaveBeenCalledWith('pic.png');
    expect(res.end).toHaveBeenCalled();
  });
});

describe('getMessageFileDownload', () => {
  it('200: streams the file when the thread exists', async () => {
    const { getS3Object } = require('../../aws/s3');
    getS3Object.mockResolvedValue(Buffer.from('file'));
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      file_type: 'ML',
      student_id: student._id
    });
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);

    await getMessageFileDownload(
      mockReq({
        user: admin,
        params: {
          studentId,
          messagesThreadId: new ObjectId().toHexString(),
          file_key: 'msg.pdf'
        }
      }),
      res,
      jest.fn()
    );

    expect(res.attachment).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    const next = jest.fn();

    await getMessageFileDownload(
      mockReq({
        user: admin,
        params: {
          studentId,
          messagesThreadId: new ObjectId().toHexString(),
          file_key: 'msg.pdf'
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('403: a student requesting an unconfirmed Essay is rejected', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      file_type: 'Essay',
      isOriginAuthorDeclarationConfirmedByStudent: false,
      student_id: student._id
    });
    const next = jest.fn();

    await getMessageFileDownload(
      mockReq({
        user: student,
        params: {
          studentId,
          messagesThreadId: new ObjectId().toHexString(),
          file_key: 'msg.pdf'
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });
});

describe('initGeneralMessagesThread', () => {
  it('forwards a 404 ErrorResponse when the student is missing', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await initGeneralMessagesThread(
      mockReq({ params: { studentId, document_category: 'CV' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('409: when the thread already exists and is already on the student', async () => {
    const existingThreadId = new ObjectId();
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      generaldocs_threads: [{ doc_thread_id: { _id: existingThreadId } }],
      editors: [],
      notification: {}
    });
    DocumentThreadService.findOneThreadDoc.mockResolvedValue({
      _id: existingThreadId
    });
    const next = jest.fn();

    await initGeneralMessagesThread(
      mockReq({ params: { studentId, document_category: 'CV' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it('200: creates a brand new general thread when none exists', async () => {
    const created = { _id: new ObjectId() };
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      editors: [],
      notification: {},
      generaldocs_threads: {
        find: jest.fn().mockReturnValue(undefined),
        create: jest.fn().mockReturnValue(created),
        push: jest.fn()
      },
      save: jest.fn().mockResolvedValue({})
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    DocumentThreadService.findOneThreadDoc.mockResolvedValue(null);
    DocumentThreadService.newThread.mockReturnValue({
      _id: new ObjectId(),
      save: jest.fn().mockResolvedValue({})
    });
    const res = mockRes();

    await initGeneralMessagesThread(
      mockReq({ params: { studentId, document_category: 'CV' } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.newThread).toHaveBeenCalled();
    expect(studentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });
});

describe('initApplicationMessagesThread', () => {
  it('200: creates the application thread and notifies editor/student', async () => {
    const application_id = new ObjectId().toHexString();
    const newAppRecord = {
      doc_thread_id: { _id: new ObjectId() }
    };
    DocumentThreadService.createApplicationThread.mockResolvedValue(
      newAppRecord
    );
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      editors: []
    });
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([
      {
        _id: { toString: () => application_id },
        programId: { school: 'MIT', program_name: 'CS' }
      }
    ]);
    const res = mockRes();

    await initApplicationMessagesThread(
      mockReq({
        params: { studentId, application_id, document_category: 'CV' }
      }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.createApplicationThread).toHaveBeenCalledWith(
      studentId,
      application_id,
      'CV'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: newAppRecord
    });
  });
});

describe('SetStatusMessagesThread (general / CV branch)', () => {
  it('200: toggles the general thread final flag, cleans up and chains next()', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const documentThreadDoc = {
      _id: { toString: () => messagesThreadId },
      file_type: 'CV',
      isFinalVersion: false,
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(documentThreadDoc);
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      agents: []
    });
    StudentService.updateStudentByFilter.mockResolvedValue({});
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      agents: []
    });
    const res = mockRes();
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, studentId },
        body: {}
      }),
      res,
      next
    );

    expect(documentThreadDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data.isFinalVersion).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    StudentService.getStudentById.mockResolvedValue({ _id: student._id });
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          studentId
        },
        body: {}
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('forwards a 404 ErrorResponse when the student is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      isFinalVersion: false,
      save: jest.fn()
    });
    StudentService.getStudentById.mockResolvedValue(null);
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          studentId
        },
        body: {}
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('handleDeleteGeneralThread', () => {
  it('200: deletes the thread + folder when thread and student exist', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({ _id: 't1' });
    StudentService.getStudentDocById.mockResolvedValue({ _id: student._id });
    DocumentThreadService.deleteThreadById.mockResolvedValue({});
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    const res = mockRes();

    await handleDeleteGeneralThread(
      mockReq({
        params: { messagesThreadId: new ObjectId().toHexString(), studentId }
      }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.deleteThreadById).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    StudentService.getStudentDocById.mockResolvedValue({ _id: student._id });
    const next = jest.fn();

    await handleDeleteGeneralThread(
      mockReq({
        params: { messagesThreadId: new ObjectId().toHexString(), studentId }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('handleDeleteProgramThread', () => {
  it('200: deletes the program thread, pulls it and cleans survey inputs', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      program_id: new ObjectId()
    });
    StudentService.getStudentDocById.mockResolvedValue({ _id: student._id });
    ApplicationService.pullDocModificationThread.mockResolvedValue({});
    DocumentThreadService.deleteThreadById.mockResolvedValue({
      file_type: 'ML'
    });
    SurveyInputService.deleteSurveyInput.mockResolvedValue({});
    const res = mockRes();

    await handleDeleteProgramThread(
      mockReq({
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          application_id: new ObjectId().toHexString(),
          studentId
        }
      }),
      res,
      jest.fn()
    );

    expect(ApplicationService.pullDocModificationThread).toHaveBeenCalled();
    expect(SurveyInputService.deleteSurveyInput).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards a 404 ErrorResponse when the student is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({ _id: 't1' });
    StudentService.getStudentDocById.mockResolvedValue(null);
    const next = jest.fn();

    await handleDeleteProgramThread(
      mockReq({
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          application_id: new ObjectId().toHexString(),
          studentId
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('assignEssayWritersToEssayTask', () => {
  it('400: rejects an invalid body', async () => {
    const res = mockRes();

    await assignEssayWritersToEssayTask(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: null
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('404: when the essay thread is not found', async () => {
    DocumentThreadService.getThreadById.mockResolvedValue(null);
    const res = mockRes();

    await assignEssayWritersToEssayTask(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: { editors: [] }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('200: applies the editor changes and chains next()', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById
      .mockResolvedValueOnce({
        _id: { toString: () => messagesThreadId },
        student_id: student._id,
        outsourced_user_id: [],
        file_type: 'Essay',
        program_id: { _id: new ObjectId() }
      })
      .mockResolvedValueOnce({
        _id: { toString: () => messagesThreadId },
        outsourced_user_id: []
      });
    userChangesHelperFunction.mockResolvedValue({
      addedUsers: [],
      removedUsers: [],
      updatedUsers: [],
      toBeInformedUsers: [],
      updatedUserIds: []
    });
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      agents: []
    });
    const res = mockRes();
    const next = jest.fn();

    await assignEssayWritersToEssayTask(
      mockReq({
        user: admin,
        params: { messagesThreadId },
        body: { editors: [] }
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalled();
  });
});

describe('getMessages', () => {
  it('200: returns a general (CV) thread with agents, editors and a deadline', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      file_type: 'CV',
      program_id: null,
      application_id: null,
      student_id: {
        _id: student._id,
        agents: [new ObjectId()],
        editors: [new ObjectId()]
      }
    });
    AuditService.getAuditLogs.mockResolvedValue([]);
    UserService.findAgents.mockResolvedValue([{ _id: 'a1' }]);
    UserService.findEditors.mockResolvedValue([{ _id: 'e1' }]);
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.agents).toEqual([{ _id: 'a1' }]);
    expect(body.editors).toEqual([{ _id: 'e1' }]);
  });

  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadById.mockResolvedValue(null);
    const next = jest.fn();

    await getMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('SetStatusMessagesThread (program / application branch)', () => {
  it('200: toggles the application thread final flag and emails agents', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const application_id = new ObjectId().toHexString();
    const documentThreadDoc = {
      _id: { toString: () => messagesThreadId },
      file_type: 'ML',
      isFinalVersion: false,
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(documentThreadDoc);
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io'
    });
    ApplicationService.getApplicationById.mockResolvedValue({
      _id: application_id,
      programId: { school: 'MIT', program_name: 'CS' },
      doc_modification_thread: [
        {
          doc_thread_id: {
            _id: { toString: () => messagesThreadId },
            file_type: 'ML'
          },
          isFinalVersion: false
        }
      ],
      save: jest.fn().mockResolvedValue({})
    });
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      agents: []
    });
    const res = mockRes();
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, studentId },
        body: { application_id }
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data.isFinalVersion).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('forwards a 404 ErrorResponse when the application is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      isFinalVersion: false,
      save: jest.fn()
    });
    StudentService.getStudentById.mockResolvedValue({ _id: student._id });
    ApplicationService.getApplicationById.mockResolvedValue(null);
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          studentId
        },
        body: { application_id: new ObjectId().toHexString() }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('postMessages', () => {
  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: { message: '"hi"' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('403: when the thread is already closed (final version)', async () => {
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      _id: 't1',
      isFinalVersion: true
    });
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: { message: '"hi"' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('400: when the message body is not valid JSON', async () => {
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      _id: 't1',
      isFinalVersion: false
    });
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: { message: 'not json {' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it('200: an admin posts a general-doc message; thread is saved and returned', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io'
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    const populated2 = {
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => studentId } }
    };
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue(populated2);
    const studentDoc = {
      notification: {},
      agents: [],
      editors: [],
      generaldocs_threads: { find: jest.fn().mockReturnValue(undefined) },
      save: jest.fn().mockResolvedValue({})
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const res = mockRes();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId },
        body: { message: '"hello"' }
      }),
      res,
      jest.fn()
    );

    expect(threadDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: populated2 });
  });

  it('200: an editor posts a general-doc message and the student is emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const { editor } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io'
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => studentId } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      firstname: 'Stu',
      lastname: 'Dent',
      notification: {},
      agents: [],
      editors: [],
      generaldocs_threads: { find: jest.fn().mockReturnValue(undefined) },
      save: jest.fn().mockResolvedValue({})
    });
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const {
      sendNewGeneraldocMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: editor,
        params: { messagesThreadId },
        body: { message: '"reviewed"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewGeneraldocMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts on their own CV thread (notifies their editors)', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const { editor } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io'
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      firstname: 'Stu',
      lastname: 'Dent',
      notification: {},
      agents: [],
      editors: [
        { firstname: 'Ed', lastname: 'It', email: 'ed@x.io', archiv: false }
      ],
      generaldocs_threads: { find: jest.fn().mockReturnValue(undefined) },
      save: jest.fn().mockResolvedValue({})
    });
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const {
      sendNewGeneraldocMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"my draft"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewGeneraldocMessageInThreadEmail).toHaveBeenCalled();
  });

  it('403: a student posting on another student thread is rejected', async () => {
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      _id: new ObjectId(),
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      student_id: { _id: new ObjectId() },
      messages: []
    });
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId: new ObjectId().toHexString() },
        body: { message: '"hi"' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });
});

describe('putThreadFavorite', () => {
  it('200: flags the thread when not already flagged', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      flag_by_user_id: []
    });
    DocumentThreadService.updateThreadById.mockResolvedValue({});
    const res = mockRes();

    await putThreadFavorite(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      messagesThreadId,
      expect.objectContaining({ $addToSet: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data.isFlagged).toBe(true);
  });

  it('200: unflags the thread when the user already flagged it', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      flag_by_user_id: [admin._id]
    });
    DocumentThreadService.updateThreadById.mockResolvedValue({});
    const res = mockRes();

    await putThreadFavorite(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      messagesThreadId,
      expect.objectContaining({ $pull: expect.any(Object) })
    );
    expect(res.send.mock.calls[0][0].data.isFlagged).toBe(false);
  });

  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadById.mockResolvedValue(null);
    const next = jest.fn();

    await putThreadFavorite(
      mockReq({
        user: admin,
        params: { messagesThreadId: new ObjectId().toHexString() }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('deleteAMessageInThread', () => {
  it('200: deletes the message and rewrites latest_message_left_by_id', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const messageId = new ObjectId().toHexString();
    const threadDoc = {
      _id: messagesThreadId,
      isFinalVersion: false,
      student_id: student._id,
      messages: [
        {
          _id: { toString: () => messageId },
          user_id: admin._id,
          file: []
        }
      ]
    };
    // first getThreadDocById (validate) + second (post-delete refresh)
    DocumentThreadService.getThreadDocById
      .mockResolvedValueOnce(threadDoc)
      .mockResolvedValueOnce({ messages: [] });
    DocumentThreadService.updateThreadById.mockResolvedValue({});
    const generalEntry = {
      doc_thread_id: { toString: () => messagesThreadId },
      save: jest.fn().mockResolvedValue({})
    };
    StudentService.getStudentDocById.mockResolvedValue({
      generaldocs_threads: [generalEntry]
    });
    ApplicationService.findByStudentIdLean.mockResolvedValue([]);
    const res = mockRes();

    await deleteAMessageInThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, messageId }
      }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.updateThreadById).toHaveBeenCalled();
    expect(generalEntry.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse when the thread is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    const next = jest.fn();

    await deleteAMessageInThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          messageId: new ObjectId().toHexString()
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('423: when the thread is a read-only final version', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      isFinalVersion: true,
      messages: []
    });
    const next = jest.fn();

    await deleteAMessageInThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          messageId: new ObjectId().toHexString()
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 423 })
    );
  });

  it('409: when a non-admin tries to delete another user message', async () => {
    const messageId = new ObjectId().toHexString();
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      isFinalVersion: false,
      messages: [
        {
          _id: { toString: () => messageId },
          user_id: new ObjectId(),
          file: []
        }
      ]
    });
    const next = jest.fn();

    await deleteAMessageInThread(
      mockReq({
        user: student,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          messageId
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: success paths + every remaining error/role/edge branch.
// ---------------------------------------------------------------------------

describe('getSurveyInputs (success)', () => {
  it('200: returns the thread merged with its survey inputs', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const programId = new ObjectId();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      file_type: 'RL_A',
      student_id: { _id: { toString: () => studentId } },
      program_id: { _id: programId }
    });
    SurveyInputService.findSurveyInputs.mockResolvedValue([
      { _id: 's-gen', programId: null },
      { _id: 's-spec', programId }
    ]);
    const res = mockRes();

    await getSurveyInputs(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(SurveyInputService.findSurveyInputs).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.surveyInputs.general).toMatchObject({ _id: 's-gen' });
    expect(body.data.surveyInputs.specific).toMatchObject({ _id: 's-spec' });
  });
});

describe('postSurveyInput / putSurveyInput / resetSurveyInput (informEditor branches)', () => {
  it('putSurveyInput informEditor true: notifies the editor after responding', async () => {
    const surveyInputId = new ObjectId().toHexString();
    SurveyInputService.updateSurveyInputById.mockResolvedValue({
      _id: surveyInputId,
      studentId,
      programId: null,
      fileType: 'RL'
    });
    DocumentThreadService.findOneThreadPopulated.mockResolvedValue({
      _id: 't'
    });
    const res = mockRes();

    await putSurveyInput(
      mockReq({
        user: admin,
        params: { surveyInputId },
        body: { input: {}, informEditor: true }
      }),
      res,
      jest.fn()
    );

    expect(informOnSurveyUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('initGeneralMessagesThread (existing thread re-attached)', () => {
  it('200: existing thread not yet on the student is added to generaldocs', async () => {
    const existingThreadId = new ObjectId();
    const created = { _id: new ObjectId() };
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      editors: [],
      notification: {},
      generaldocs_threads: {
        find: jest.fn().mockReturnValue(undefined),
        create: jest.fn().mockReturnValue(created),
        push: jest.fn()
      },
      save: jest.fn().mockResolvedValue({})
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    DocumentThreadService.findOneThreadDoc.mockResolvedValue({
      _id: existingThreadId
    });
    const res = mockRes();

    await initGeneralMessagesThread(
      mockReq({ params: { studentId, document_category: 'CV' } }),
      res,
      jest.fn()
    );

    expect(studentDoc.generaldocs_threads.push).toHaveBeenCalledWith(created);
    expect(studentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });

  it('200: creates a new thread and emails non-archived editors + student', async () => {
    const created = { _id: new ObjectId() };
    const {
      assignDocumentTaskToEditorEmail,
      assignDocumentTaskToStudentEmail
    } = require('../../services/email');
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: false,
      editors: [
        { firstname: 'Ed', lastname: 'It', email: 'ed@x.io', archiv: false }
      ],
      notification: {},
      generaldocs_threads: {
        find: jest.fn().mockReturnValue(undefined),
        create: jest.fn().mockReturnValue(created),
        push: jest.fn()
      },
      save: jest.fn().mockResolvedValue({})
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    DocumentThreadService.findOneThreadDoc.mockResolvedValue(null);
    DocumentThreadService.newThread.mockReturnValue({
      _id: new ObjectId(),
      save: jest.fn().mockResolvedValue({})
    });
    const res = mockRes();

    await initGeneralMessagesThread(
      mockReq({ params: { studentId, document_category: 'CV' } }),
      res,
      jest.fn()
    );

    expect(assignDocumentTaskToEditorEmail).toHaveBeenCalledTimes(1);
    expect(assignDocumentTaskToStudentEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('initApplicationMessagesThread (Essay scope)', () => {
  it('200: an Essay thread notifies the editor-leads who can assign editors', async () => {
    const application_id = new ObjectId().toHexString();
    const newAppRecord = { doc_thread_id: { _id: new ObjectId() } };
    DocumentThreadService.createApplicationThread.mockResolvedValue(
      newAppRecord
    );
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: false,
      editors: []
    });
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([
      {
        _id: { toString: () => application_id },
        programId: { school: 'MIT', program_name: 'CS' }
      }
    ]);
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      {
        user_id: {
          firstname: 'Lead',
          lastname: 'Er',
          email: 'lead@x.io',
          archiv: false
        }
      }
    ]);
    const { assignEssayTaskToEditorEmail } = require('../../services/email');
    const res = mockRes();

    await initApplicationMessagesThread(
      mockReq({
        params: { studentId, application_id, document_category: 'Essay' }
      }),
      res,
      jest.fn()
    );

    expect(assignEssayTaskToEditorEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('putThreadFavorite (update failure)', () => {
  it('forwards a 500 ErrorResponse when the update throws', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      flag_by_user_id: []
    });
    DocumentThreadService.updateThreadById.mockRejectedValue(
      new Error('write failed')
    );
    const next = jest.fn();

    await putThreadFavorite(
      mockReq({ user: admin, params: { messagesThreadId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 })
    );
  });
});

describe('getMessages (program / RL branches + conflict list)', () => {
  it('200: an RL thread computes an RL deadline and a conflict list for staff', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const programId = new ObjectId();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      file_type: 'Recommendation_Letter_A',
      program_id: { _id: programId },
      application_id: { application_year: '2025' },
      student_id: {
        _id: student._id,
        agents: [new ObjectId()],
        editors: [new ObjectId()]
      }
    });
    DocumentThreadService.getThreads.mockResolvedValue([{ _id: 'sim' }]);
    AuditService.getAuditLogs.mockResolvedValue([]);
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    ApplicationService.findConflictApplications.mockResolvedValue([
      { _id: 'c1' }
    ]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.findConflictApplications).toHaveBeenCalled();
    const body = res.send.mock.calls[0][0];
    expect(body.conflict_list).toEqual([{ _id: 'c1' }]);
    expect(body.similarThreads).toEqual([{ _id: 'sim' }]);
  });

  it('200: a program-specific (non-general) thread computes the V2 deadline', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      file_type: 'ML',
      program_id: { _id: new ObjectId() },
      application_id: new ObjectId(),
      student_id: {
        _id: student._id,
        agents: [],
        editors: []
      }
    });
    DocumentThreadService.getThreads.mockResolvedValue([]);
    AuditService.getAuditLogs.mockResolvedValue([]);
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    ApplicationService.getApplicationById.mockResolvedValue({
      programId: { application_deadline: '2025-01-01' }
    });
    ApplicationService.findConflictApplications.mockResolvedValue([]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.getApplicationById).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200: a student sees no similarThreads and no conflict list', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      file_type: 'CV',
      program_id: null,
      application_id: null,
      student_id: { _id: student._id, agents: [], editors: [] }
    });
    AuditService.getAuditLogs.mockResolvedValue([]);
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: student, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    const body = res.send.mock.calls[0][0];
    expect(body.similarThreads).toBeNull();
    expect(body.conflict_list).toEqual([]);
    expect(ApplicationService.findConflictApplications).not.toHaveBeenCalled();
  });
});

describe('postMessages (agent / essay + interview branches)', () => {
  const baseStudentDoc = () => ({
    _id: new ObjectId(),
    firstname: 'Stu',
    lastname: 'Dent',
    email: 's@x.io',
    archiv: false,
    notification: {},
    agents: [
      { firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io', archiv: false }
    ],
    editors: [
      { firstname: 'Ed', lastname: 'It', email: 'ed@x.io', archiv: false }
    ],
    generaldocs_threads: { find: jest.fn().mockReturnValue(undefined) },
    save: jest.fn().mockResolvedValue({})
  });

  it('200: an admin posts on a program ML thread; agents + editors + student emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'ML',
      outsourced_user_id: [],
      program_id: {
        _id: programId,
        school: 'MIT',
        program_name: 'CS'
      },
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      baseStudentDoc()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    const {
      sendNewApplicationMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: an agent posts on an Essay thread; outsourced writers are emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const { agent } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Essay',
      program_id: null,
      outsourced_user_id: [
        { firstname: 'Wr', lastname: 'Iter', email: 'wr@x.io', archiv: false }
      ],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      baseStudentDoc()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const {
      sendNewGeneraldocMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: agent,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewGeneraldocMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts an Essay with no writer assigned -> reminders sent', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Essay',
      program_id: null,
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      baseStudentDoc()
    );
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      {
        user_id: { firstname: 'L', lastname: 'D', email: 'l@x.io' }
      }
    ]);
    const {
      sendAssignEssayWriterReminderEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendAssignEssayWriterReminderEmail).toHaveBeenCalled();
  });

  it('423: rejects duplicate file extensions in a single message', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      _id: new ObjectId(),
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      student_id: { _id: student._id },
      messages: []
    });
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId },
        body: { message: '"hi"' },
        files: [
          { key: 'a/b/m1.pdf', mimetype: 'application/pdf' },
          { key: 'a/b/m2.pdf', mimetype: 'application/pdf' }
        ]
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 423 })
    );
  });
});

describe('SetStatusMessagesThread (application thread not found)', () => {
  it('forwards a 404 ErrorResponse when the application thread is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      isFinalVersion: false,
      save: jest.fn()
    });
    StudentService.getStudentById.mockResolvedValue({ _id: student._id });
    ApplicationService.getApplicationById.mockResolvedValue({
      _id: 'app',
      doc_modification_thread: [],
      save: jest.fn()
    });
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          studentId
        },
        body: { application_id: new ObjectId().toHexString() }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('deleteAMessageInThread (file deletion + program branch)', () => {
  it('200: deletes a message with files and rewrites latest from the remaining message', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const messageId = new ObjectId().toHexString();
    const otherUser = new ObjectId();
    const threadDoc = {
      _id: messagesThreadId,
      isFinalVersion: false,
      student_id: student._id,
      messages: [
        {
          _id: { toString: () => messageId },
          user_id: admin._id,
          file: [{ path: `${studentId}/${messagesThreadId}/m.pdf` }]
        }
      ]
    };
    DocumentThreadService.getThreadDocById
      .mockResolvedValueOnce(threadDoc)
      .mockResolvedValueOnce({
        messages: [{ user_id: otherUser, updatedAt: new Date() }]
      });
    DocumentThreadService.updateThreadById.mockResolvedValue({});
    const appEntry = {
      doc_thread_id: { toString: () => messagesThreadId },
      save: jest.fn().mockResolvedValue({})
    };
    StudentService.getStudentDocById.mockResolvedValue({
      generaldocs_threads: []
    });
    ApplicationService.findByStudentIdLean.mockResolvedValue([
      { doc_modification_thread: [appEntry] }
    ]);
    const { deleteS3Objects } = require('../../aws/s3');
    const res = mockRes();

    await deleteAMessageInThread(
      mockReq({ user: admin, params: { messagesThreadId, messageId } }),
      res,
      jest.fn()
    );

    expect(deleteS3Objects).toHaveBeenCalled();
    expect(appEntry.save).toHaveBeenCalled();
    expect(appEntry.latest_message_left_by_id).toBe(otherUser.toString());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards a 404 ErrorResponse when the message id is not in the thread', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      isFinalVersion: false,
      messages: [
        { _id: { toString: () => 'other' }, user_id: admin._id, file: [] }
      ]
    });
    const next = jest.fn();

    await deleteAMessageInThread(
      mockReq({
        user: admin,
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          messageId: new ObjectId().toHexString()
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('assignEssayWritersToEssayTask (writers added)', () => {
  it('200: persists new writers and informs writers, agents and the student', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const programId = new ObjectId();
    const writer = {
      firstname: 'Wr',
      lastname: 'Iter',
      email: 'wr@x.io',
      archiv: false
    };
    DocumentThreadService.getThreadById
      .mockResolvedValueOnce({
        _id: { toString: () => messagesThreadId },
        student_id: student._id,
        outsourced_user_id: [],
        file_type: 'Essay',
        program_id: programId
      })
      .mockResolvedValueOnce({
        _id: { toString: () => messagesThreadId },
        outsourced_user_id: [writer]
      });
    userChangesHelperFunction.mockResolvedValue({
      addedUsers: [writer],
      removedUsers: [],
      updatedUsers: [writer],
      toBeInformedUsers: [writer],
      updatedUserIds: [new ObjectId().toHexString()]
    });
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: false,
      agents: [
        { firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io', archiv: false }
      ]
    });
    DocumentThreadService.updateThreadById.mockResolvedValue({});
    const {
      informEssayWriterNewEssayEmail,
      informAgentEssayAssignedEmail,
      informStudentTheirEssayWriterEmail
    } = require('../../services/email');
    const res = mockRes();
    const next = jest.fn();

    await assignEssayWritersToEssayTask(
      mockReq({
        user: admin,
        params: { messagesThreadId },
        body: { editors: ['x'] }
      }),
      res,
      next
    );

    expect(DocumentThreadService.updateThreadById).toHaveBeenCalled();
    expect(informEssayWriterNewEssayEmail).toHaveBeenCalledTimes(1);
    expect(informAgentEssayAssignedEmail).toHaveBeenCalledTimes(1);
    expect(informStudentTheirEssayWriterEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalled();
  });
});

describe('initApplicationMessagesThread (editor non-essay email)', () => {
  it('200: a CV thread emails the non-archived editors and the student', async () => {
    const application_id = new ObjectId().toHexString();
    const newAppRecord = { doc_thread_id: { _id: new ObjectId() } };
    DocumentThreadService.createApplicationThread.mockResolvedValue(
      newAppRecord
    );
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: false,
      editors: [
        { firstname: 'Ed', lastname: 'It', email: 'ed@x.io', archiv: false }
      ]
    });
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([
      {
        _id: { toString: () => application_id },
        programId: { school: 'MIT', program_name: 'CS' }
      }
    ]);
    const {
      assignDocumentTaskToEditorEmail,
      assignDocumentTaskToStudentEmail
    } = require('../../services/email');
    const res = mockRes();

    await initApplicationMessagesThread(
      mockReq({
        params: { studentId, application_id, document_category: 'CV' }
      }),
      res,
      jest.fn()
    );

    expect(assignDocumentTaskToEditorEmail).toHaveBeenCalledTimes(1);
    expect(assignDocumentTaskToStudentEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('SetStatusMessagesThread (program branch emails agents)', () => {
  it('200: emails the student and the non-archived agents on the program final flag', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const application_id = new ObjectId().toHexString();
    const documentThreadDoc = {
      _id: { toString: () => messagesThreadId },
      file_type: 'ML',
      isFinalVersion: false,
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(documentThreadDoc);
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: false
    });
    ApplicationService.getApplicationById.mockResolvedValue({
      _id: application_id,
      programId: { school: 'MIT', program_name: 'CS' },
      doc_modification_thread: [
        {
          doc_thread_id: {
            _id: { toString: () => messagesThreadId },
            file_type: 'ML'
          },
          isFinalVersion: false
        }
      ],
      save: jest.fn().mockResolvedValue({})
    });
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      archiv: false,
      agents: [
        { firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io', archiv: false }
      ]
    });
    const {
      sendSetAsFinalProgramSpecificFileForStudentEmail,
      sendSetAsFinalProgramSpecificFileForAgentEmail
    } = require('../../services/email');
    const res = mockRes();
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, studentId },
        body: { application_id }
      }),
      res,
      next
    );

    expect(sendSetAsFinalProgramSpecificFileForStudentEmail).toHaveBeenCalled();
    expect(sendSetAsFinalProgramSpecificFileForAgentEmail).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('SetStatusMessagesThread (general branch emails agents)', () => {
  it('200: emails the student and non-archived agents on the general final flag', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const documentThreadDoc = {
      _id: { toString: () => messagesThreadId },
      file_type: 'CV',
      isFinalVersion: false,
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(documentThreadDoc);
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: false,
      agents: [{ firstname: 'Ag' }]
    });
    StudentService.updateStudentByFilter.mockResolvedValue({});
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      archiv: false,
      agents: [
        { firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io', archiv: false }
      ]
    });
    const {
      sendSetAsFinalGeneralFileForStudentEmail,
      sendSetAsFinalGeneralFileForAgentEmail
    } = require('../../services/email');
    const res = mockRes();
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, studentId },
        body: {}
      }),
      res,
      next
    );

    expect(sendSetAsFinalGeneralFileForStudentEmail).toHaveBeenCalled();
    expect(sendSetAsFinalGeneralFileForAgentEmail).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('handleDeleteProgramThread / handleDeleteGeneralThread (thread missing)', () => {
  it('handleDeleteProgramThread forwards a 404 when the thread is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    const next = jest.fn();

    await handleDeleteProgramThread(
      mockReq({
        params: {
          messagesThreadId: new ObjectId().toHexString(),
          application_id: new ObjectId().toHexString(),
          studentId
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('handleDeleteGeneralThread forwards a 404 when the student is missing', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({ _id: 't1' });
    StudentService.getStudentDocById.mockResolvedValue(null);
    const next = jest.fn();

    await handleDeleteGeneralThread(
      mockReq({
        params: { messagesThreadId: new ObjectId().toHexString(), studentId }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('deleteAMessageInThread (S3 delete failure)', () => {
  it('forwards a 500 ErrorResponse when deleting the thread files throws', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const messageId = new ObjectId().toHexString();
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: messagesThreadId,
      isFinalVersion: false,
      student_id: student._id,
      messages: [
        {
          _id: { toString: () => messageId },
          user_id: admin._id,
          file: [{ path: 'a/b/m.pdf' }]
        }
      ]
    });
    const { deleteS3Objects } = require('../../aws/s3');
    deleteS3Objects.mockRejectedValueOnce(new Error('s3 down'));
    const next = jest.fn();

    await deleteAMessageInThread(
      mockReq({ user: admin, params: { messagesThreadId, messageId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 })
    );
  });
});

describe('SetStatusMessagesThread (S3 cleanup error is swallowed)', () => {
  it('200: a general-thread final flag still responds when GC throws', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const documentThreadDoc = {
      _id: { toString: () => messagesThreadId },
      file_type: 'CV',
      isFinalVersion: false,
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(documentThreadDoc);
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: true, // archived -> skips the student/agent emails
      agents: []
    });
    StudentService.updateStudentByFilter.mockResolvedValue({});
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      agents: []
    });
    const { threadS3GarbageCollector } = require('../../utils/utils_function');
    threadS3GarbageCollector.mockRejectedValueOnce(new Error('gc boom'));
    const res = mockRes();
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, studentId },
        body: {}
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalled();
  });
});

describe('SetStatusMessagesThread (program S3 cleanup error is swallowed)', () => {
  it('200: a program-thread final flag still responds when GC throws', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const application_id = new ObjectId().toHexString();
    const documentThreadDoc = {
      _id: { toString: () => messagesThreadId },
      file_type: 'ML',
      isFinalVersion: false,
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(documentThreadDoc);
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@x.io',
      archiv: true // archived -> skip emails, focus on the GC catch
    });
    ApplicationService.getApplicationById.mockResolvedValue({
      _id: application_id,
      programId: { school: 'MIT', program_name: 'CS' },
      doc_modification_thread: [
        {
          doc_thread_id: {
            _id: { toString: () => messagesThreadId },
            file_type: 'ML'
          },
          isFinalVersion: false
        }
      ],
      save: jest.fn().mockResolvedValue({})
    });
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      archiv: true,
      agents: []
    });
    const { threadS3GarbageCollector } = require('../../utils/utils_function');
    threadS3GarbageCollector.mockRejectedValueOnce(new Error('gc boom'));
    const res = mockRes();
    const next = jest.fn();

    await SetStatusMessagesThread(
      mockReq({
        user: admin,
        params: { messagesThreadId, studentId },
        body: { application_id }
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalled();
  });
});

describe('handleDeleteGeneralThread (delete failure propagates)', () => {
  it('forwards the error to next() when deleteThreadById throws', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({ _id: 't1' });
    StudentService.getStudentDocById.mockResolvedValue({ _id: student._id });
    DocumentThreadService.deleteThreadById.mockRejectedValue(
      new Error('delete failed')
    );
    const next = jest.fn();

    await handleDeleteGeneralThread(
      mockReq({
        params: { messagesThreadId: new ObjectId().toHexString(), studentId }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'delete failed' })
    );
  });
});

describe('getMyStudentMetrics (general-thread needToReply)', () => {
  it('200: flags needToReply when the last general-thread message is the student', async () => {
    const studentId2 = new ObjectId();
    const students = [
      {
        _id: studentId2,
        applications: [],
        generaldocs_threads: [
          {
            isFinalVersion: false,
            updatedAt: new Date(),
            doc_thread_id: {
              _id: 'th-gen',
              isFinalVersion: false,
              messages: [
                { user_id: { _id: { toString: () => String(studentId2) } } }
              ]
            }
          }
        ]
      }
    ];
    StudentService.getStudentsWithApplications.mockResolvedValue(students);
    const res = mockRes();

    await getMyStudentMetrics(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data.students).toHaveLength(1);
    expect(body.data.students[0].threadCount).toBe(1);
    expect(body.data.students[0].needToReply).toBe(true);
  });

  it('200: counts threads from a decided application', async () => {
    const studentId2 = new ObjectId();
    const students = [
      {
        _id: studentId2,
        applications: [
          {
            decided: 'O',
            doc_modification_thread: [
              {
                isFinalVersion: false,
                doc_thread_id: {
                  _id: 'th-app',
                  isFinalVersion: true,
                  messages: [
                    { user_id: { _id: { toString: () => String(studentId2) } } }
                  ]
                }
              }
            ]
          }
        ],
        generaldocs_threads: []
      }
    ];
    StudentService.getStudentsWithApplications.mockResolvedValue(students);
    const res = mockRes();

    await getMyStudentMetrics(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data.students[0].threadCount).toBe(1);
    expect(body.data.students[0].completeThreadCount).toBe(1);
  });
});

describe('getMessageImageDownload (cache hit)', () => {
  it('serves the cached buffer without touching S3', async () => {
    const { ten_minutes_cache } = require('../../cache/node-cache');
    ten_minutes_cache.get.mockReturnValueOnce(Buffer.from('cached'));
    const { getS3Object } = require('../../aws/s3');
    const messagesThreadId = new ObjectId().toHexString();
    const res = mockRes();
    res.attachment = jest.fn(() => res);

    await getMessageImageDownload(
      mockReq({
        params: { messagesThreadId, studentId, file_name: 'pic.png' },
        originalUrl: `/a/b/c/d/e/${messagesThreadId}`
      }),
      res,
      jest.fn()
    );

    expect(getS3Object).not.toHaveBeenCalled();
    expect(res.attachment).toHaveBeenCalledWith('pic.png');
    expect(res.end).toHaveBeenCalled();
  });
});

describe('postMessages (more student / agent / interview branches)', () => {
  const studentDocWith = (overrides = {}) => ({
    _id: new ObjectId(),
    firstname: 'Stu',
    lastname: 'Dent',
    email: 's@x.io',
    archiv: false,
    notification: {},
    agents: [
      { firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io', archiv: false }
    ],
    editors: [
      { firstname: 'Ed', lastname: 'It', email: 'ed@x.io', archiv: false }
    ],
    generaldocs_threads: { find: jest.fn().mockReturnValue(undefined) },
    save: jest.fn().mockResolvedValue({}),
    ...overrides
  });

  it('200: a student posts a Supplementary_Form -> agent is emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Supplementary_Form',
      program_id: null,
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const {
      sendNewGeneraldocMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"a form"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewGeneraldocMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts a CV with NO editor -> editor-assign reminders sent', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith({ editors: [] })
    );
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      { user_id: { firstname: 'L', lastname: 'D', email: 'l@x.io' } }
    ]);
    const { sendAssignEditorReminderEmail } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"draft"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendAssignEditorReminderEmail).toHaveBeenCalled();
  });

  it('200: a student posts an Interview thread with no trainer -> trainer reminder', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Interview',
      outsourced_user_id: [],
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    InterviewService.findOneInterview.mockResolvedValue({
      _id: new ObjectId(),
      trainer_id: [],
      program_id: { _id: programId },
      student_id: { firstname: 'Stu' }
    });
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      { user_id: { firstname: 'L', lastname: 'D', email: 'l@x.io' } }
    ]);
    const { sendAssignTrainerReminderEmail } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"interview prep"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendAssignTrainerReminderEmail).toHaveBeenCalled();
  });

  it('200: an editor posts an Interview program thread -> student interview email', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const { editor } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Interview',
      outsourced_user_id: [],
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    InterviewService.findOneInterview.mockResolvedValue({
      _id: new ObjectId()
    });
    const {
      sendNewInterviewMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: editor,
        params: { messagesThreadId },
        body: { message: '"reviewed"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewInterviewMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: an editor posts on a program ML thread -> student application email', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const { editor } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'ML',
      outsourced_user_id: [],
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    const {
      sendNewApplicationMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: editor,
        params: { messagesThreadId },
        body: { message: '"reviewed"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: an agent posts on a program Interview thread -> trainer + student emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const { agent } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Interview',
      outsourced_user_id: [],
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    InterviewService.findOneInterview.mockResolvedValue({
      _id: new ObjectId(),
      trainer_id: [
        { firstname: 'Tr', lastname: 'Ainer', email: 'tr@x.io', archiv: false }
      ],
      program_id: { _id: programId },
      student_id: { firstname: 'Stu' }
    });
    const {
      sendNewInterviewMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: agent,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewInterviewMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts a program Supplementary_Form -> agent emailed with school/program', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Supplementary_Form',
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    const {
      sendNewApplicationMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"a form"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts a program ML thread with editors -> editors emailed school/program', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'ML',
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    const {
      sendNewApplicationMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"draft"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts an Essay program thread with outsourced writers -> writers emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Essay',
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      outsourced_user_id: [
        { firstname: 'Wr', lastname: 'Iter', email: 'wr@x.io', archiv: false }
      ],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    const {
      sendNewApplicationMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"essay draft"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: a student posts an Interview program thread with an active trainer -> trainer emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Interview',
      outsourced_user_id: [],
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    InterviewService.findOneInterview.mockResolvedValue({
      _id: new ObjectId(),
      trainer_id: [
        { firstname: 'Tr', lastname: 'Ainer', email: 'tr@x.io', archiv: false }
      ],
      program_id: { _id: programId },
      student_id: { firstname: 'Stu' }
    });
    const {
      sendNewInterviewMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { messagesThreadId },
        body: { message: '"interview prep"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewInterviewMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: an agent posts a program Essay thread with outsourced writers -> writers emailed', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const programId = new ObjectId();
    const { agent } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Essay',
      program_id: { _id: programId, school: 'MIT', program_name: 'CS' },
      outsourced_user_id: [
        { firstname: 'Wr', lastname: 'Iter', email: 'wr@x.io', archiv: false }
      ],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: { _id: programId },
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([
      {
        programId: { _id: programId },
        doc_modification_thread: [
          {
            doc_thread_id: docId,
            latest_message_left_by_id: '',
            updatedAt: new Date()
          }
        ],
        save: jest.fn().mockResolvedValue({})
      }
    ]);
    const {
      sendNewApplicationMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: agent,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: an agent posts a general Essay thread with outsourced writers', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const { agent } = require('../mock/user');
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'Essay',
      program_id: null,
      outsourced_user_id: [
        { firstname: 'Wr', lastname: 'Iter', email: 'wr@x.io', archiv: false }
      ],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith()
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const {
      sendNewGeneraldocMessageInThreadEmail
    } = require('../../services/email');
    const res = mockRes();

    await postMessages(
      mockReq({
        user: agent,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendNewGeneraldocMessageInThreadEmail).toHaveBeenCalled();
  });

  it('200: an admin posts a general-doc thread that lives in student.generaldocs_threads', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const docId = new ObjectId();
    const generalEntry = {
      doc_thread_id: { toString: () => docId.toString() },
      updatedAt: new Date()
    };
    const threadDoc = {
      _id: docId,
      isFinalVersion: false,
      file_type: 'CV',
      program_id: null,
      outsourced_user_id: [],
      student_id: {
        _id: student._id,
        firstname: 'Stu',
        lastname: 'Dent',
        email: 's@x.io',
        archiv: false
      },
      messages: [],
      save: jest.fn().mockResolvedValue({})
    };
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      _id: docId,
      program_id: null,
      student_id: { _id: { toString: () => student._id.toString() } }
    });
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(
      studentDocWith({
        generaldocs_threads: {
          find: jest.fn().mockReturnValue(generalEntry)
        }
      })
    );
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    const res = mockRes();

    await postMessages(
      mockReq({
        user: admin,
        params: { messagesThreadId },
        body: { message: '"hi"' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    // controller stamped the latest author onto the general thread entry
    expect(generalEntry.latest_message_left_by_id).toBe(admin._id.toString());
  });
});

describe('getMessageFileDownload (student multitenancy)', () => {
  it('403: a student downloading another student thread file is rejected', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: 't1',
      file_type: 'ML',
      student_id: new ObjectId()
    });
    const next = jest.fn();

    await getMessageFileDownload(
      mockReq({
        user: student,
        params: {
          studentId,
          messagesThreadId: new ObjectId().toHexString(),
          file_key: 'msg.pdf'
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });
});
