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
const { informOnSurveyUpdate } = require('../../utils/informEditor');
const {
  getActiveThreads,
  getMyStudentsThreads,
  getThreadsByStudent,
  postSurveyInput,
  putSurveyInput,
  resetSurveyInput,
  putOriginAuthorConfirmedByStudent,
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

describe('resetSurveyInput', () => {
  it('200: resets by surveyInputId and returns the updated survey', async () => {
    const surveyInputId = new ObjectId().toHexString();
    const reset = { _id: surveyInputId, surveyStatus: 'empty' };
    SurveyInputService.resetSurveyInputById.mockResolvedValue(reset);
    const res = mockRes();

    await resetSurveyInput(
      mockReq({
        user: admin,
        params: { surveyInputId },
        body: { informEditor: false }
      }),
      res,
      jest.fn()
    );

    expect(SurveyInputService.resetSurveyInputById).toHaveBeenCalledWith(
      surveyInputId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: reset });
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
