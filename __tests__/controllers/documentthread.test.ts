// Controller UNIT test for the message-thread handlers of
// controllers/documents_modification (the "document thread" surface).
//
// These handlers are the tangled ones: a single call fans out to many services
// (DocumentThread/Student/User/Application/Audit/...) and touches S3, node-cache
// and email. We call each handler DIRECTLY as a (req, res, next) function with
// ALL of those modules mocked, so NOTHING real runs below the controller. We
// assert ONLY the controller's own work: the args it forwards, the status + body
// it writes, the not-found / final-version guards it owns, and that a service
// error is forwarded to next().
//
// The sibling CRUD/overview/survey-input handlers are unit-tested in
// __tests__/controllers/documents_modification.test.js. Full route -> service ->
// dao -> in-memory Mongo wiring lives in __tests__/integration/documentthread.test.js.

jest.mock('../../services/documentthreads');
jest.mock('../../services/students');
jest.mock('../../services/users');
jest.mock('../../services/applications');
jest.mock('../../services/surveyInputs');
jest.mock('../../services/permissions');
jest.mock('../../services/interviews');
jest.mock('../../services/audit');
jest.mock('../../utils/informEditor', () => ({
  informOnSurveyUpdate: jest.fn().mockResolvedValue({})
}));
jest.mock('../../utils/modelHelper/versionControl', () => ({
  // Keep the schema plugins (handleProgramChanges/enableVersionControl) real —
  // models/Program.js applies them at compile time and they must be functions.
  // Only the S3 directory-wipe is stubbed so deletes never hit AWS.
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

const { ObjectId } = require('mongoose').Types;
const DocumentThreadService = require('../../services/documentthreads');
const StudentService = require('../../services/students');
const UserService = require('../../services/users');
const ApplicationService = require('../../services/applications');
const AuditService = require('../../services/audit');
const SurveyInputService = require('../../services/surveyInputs');
const {
  getSurveyInputs,
  getMessages,
  putThreadFavorite,
  deleteAMessageInThread,
  handleDeleteGeneralThread,
  handleDeleteProgramThread
} = require('../../controllers/documents_modification');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, agent, student } = require('../mock/user');

const studentId = student._id.toString();
const adminId = admin._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getSurveyInputs', () => {
  it('200: returns the thread merged with its resolved survey inputs', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      student_id: { _id: student._id },
      program_id: null,
      file_type: 'ML'
    });
    SurveyInputService.findSurveyInputs.mockResolvedValue([]);
    const res = mockRes();

    await getSurveyInputs(
      mockReq({ params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.getThreadById).toHaveBeenCalledWith(
      messagesThreadId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('surveyInputs');
  });

  it('forwards a 404 ErrorResponse to next() for an invalid thread id', async () => {
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

describe('getMessages', () => {
  it('200: aggregates thread + agents/editors/applications/audit for a general (CV) thread', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      file_type: 'CV', // general doc -> CVDeadline_Calculator, no program lookup
      program_id: null,
      application_id: null,
      student_id: { _id: student._id, agents: [], editors: [] }
    });
    UserService.findAgents.mockResolvedValue([{ _id: 'a1' }]);
    UserService.findEditors.mockResolvedValue([]);
    ApplicationService.findByStudentIdWithProgram.mockResolvedValue([]);
    AuditService.getAuditLogs.mockResolvedValue([]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { messagesThreadId } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.getThreadById).toHaveBeenCalledWith(
      messagesThreadId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.agents).toEqual([{ _id: 'a1' }]);
    expect(body.editors).toEqual([]);
  });

  it('forwards a 404 ErrorResponse to next() when the thread is missing', async () => {
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

describe('putThreadFavorite', () => {
  it('200: ADDS the user to favourites when not already flagged', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      flag_by_user_id: [] // not flagged
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
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { isFlagged: true }
    });
  });

  it('200: REMOVES the user from favourites when already flagged', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadById.mockResolvedValue({
      _id: messagesThreadId,
      flag_by_user_id: [admin._id] // already flagged
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
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { isFlagged: false }
    });
  });

  it('forwards a 404 ErrorResponse to next() when the thread is missing', async () => {
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
  it('200: pulls the message the admin owns and responds success', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const messageId = new ObjectId().toHexString();
    // First getThreadDocById -> thread with the message; second call (after
    // delete) -> the refreshed thread used to recompute latest_message.
    DocumentThreadService.getThreadDocById
      .mockResolvedValueOnce({
        _id: messagesThreadId,
        isFinalVersion: false,
        student_id: student._id,
        messages: [{ _id: messageId, user_id: admin._id, file: [] }]
      })
      .mockResolvedValueOnce({ _id: messagesThreadId, messages: [] });
    DocumentThreadService.updateThreadById.mockResolvedValue({});
    StudentService.getStudentDocById.mockResolvedValue({
      generaldocs_threads: [
        {
          doc_thread_id: messagesThreadId,
          save: jest.fn().mockResolvedValue({})
        }
      ]
    });
    ApplicationService.findByStudentIdLean.mockResolvedValue([]);
    const res = mockRes();

    await deleteAMessageInThread(
      mockReq({ user: admin, params: { messagesThreadId, messageId } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      messagesThreadId,
      expect.objectContaining({ $pull: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse to next() when the thread is missing', async () => {
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

  it('forwards a 409 ErrorResponse to next() when deleting another users message', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const messageId = new ObjectId().toHexString();
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: messagesThreadId,
      isFinalVersion: false,
      messages: [{ _id: messageId, user_id: student._id, file: [] }]
    });
    const next = jest.fn();

    // agent (non-admin) tries to delete a message authored by the student
    await deleteAMessageInThread(
      mockReq({ user: agent, params: { messagesThreadId, messageId } }),
      mockRes(),
      next
    );

    expect(DocumentThreadService.updateThreadById).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
  });
});

describe('handleDeleteGeneralThread', () => {
  it('200: deletes the thread + unlinks it from the student', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: messagesThreadId
    });
    StudentService.getStudentDocById.mockResolvedValue({ _id: student._id });
    DocumentThreadService.deleteThreadById.mockResolvedValue({});
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    const res = mockRes();

    await handleDeleteGeneralThread(
      mockReq({ params: { messagesThreadId, studentId } }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.deleteThreadById).toHaveBeenCalledWith(
      messagesThreadId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse to next() when the thread is missing', async () => {
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

    expect(DocumentThreadService.deleteThreadById).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('handleDeleteProgramThread', () => {
  it('200: pulls the thread from the application and deletes survey + thread', async () => {
    const messagesThreadId = new ObjectId().toHexString();
    const application_id = new ObjectId().toHexString();
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      _id: messagesThreadId,
      program_id: new ObjectId().toHexString()
    });
    StudentService.getStudentDocById.mockResolvedValue({ _id: student._id });
    ApplicationService.pullDocModificationThread.mockResolvedValue({});
    DocumentThreadService.deleteThreadById.mockResolvedValue({
      file_type: 'ML'
    });
    SurveyInputService.deleteSurveyInput.mockResolvedValue({});
    const res = mockRes();

    await handleDeleteProgramThread(
      mockReq({ params: { messagesThreadId, application_id, studentId } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.pullDocModificationThread).toHaveBeenCalledWith(
      application_id,
      messagesThreadId
    );
    expect(DocumentThreadService.deleteThreadById).toHaveBeenCalledWith(
      messagesThreadId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});
