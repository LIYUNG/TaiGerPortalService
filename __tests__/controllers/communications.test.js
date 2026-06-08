// Controller UNIT test for controllers/communications (the chat routes).
//
// The handlers are plain (req, res, next) functions, so we call them DIRECTLY
// with fake req/res/next and MOCKED collaborators (CommunicationService,
// StudentService, the getPermission util — which otherwise hits
// PermissionService + node-cache — the email module, and the S3 helpers). No
// route, no middleware, no database — only the controller's own work:
//   - what it pulls off req (params/body/user),
//   - the args it forwards to the service,
//   - the status + body it writes to res (note: it reverses the thread),
//   - that it forwards a service error to next().
// Route + middleware wiring + real persistence is covered by
// __tests__/integration/communications.test.js.

jest.mock('../../services/communications');
jest.mock('../../services/students');
jest.mock('../../services/email', () => ({
  sendAgentNewMessageReminderEmail: jest.fn(),
  sendStudentNewMessageReminderEmail: jest.fn()
}));
// getPermission (utils/queryFunctions) caches a PermissionService lookup; stub
// it so the staff-scoping branches don't reach the DB / node-cache.
jest.mock('../../utils/queryFunctions', () => ({
  ...jest.requireActual('../../utils/queryFunctions'),
  getPermission: jest.fn().mockResolvedValue({ canAccessAllChat: true })
}));
// S3 helpers used by getChatFile / delete handler.
jest.mock('../../aws/s3', () => ({
  ...jest.requireActual('../../aws/s3'),
  deleteS3Objects: jest.fn().mockResolvedValue(undefined),
  getS3Object: jest.fn().mockResolvedValue(Buffer.from(''))
}));

const CommunicationService = require('../../services/communications');
const StudentService = require('../../services/students');
const { ten_minutes_cache } = require('../../cache/node-cache');
const {
  getUnreadNumberMessages,
  getMyMessages,
  loadMessages,
  getMessages,
  postMessages,
  updateAMessageInThread,
  deleteAMessageInCommunicationThread,
  IgnoreMessage
} = require('../../controllers/communications');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

const studentId = student._id.toString();
const messageId = '6f9f1b9b9b9b9b9b9b9b9b9b';
const validMessage =
  '{"time":1709234667356,"blocks":[{"id":"a","type":"paragraph","data":{"text":"hi"}}],"version":"2.29.0"}';

beforeEach(() => {
  jest.clearAllMocks();
  // node-cache is used by getChatFile / delete handlers; flush so each test is
  // isolated from a previously-cached value.
  ten_minutes_cache.flushAll();
});

describe('getUnreadNumberMessages', () => {
  it('staff: responds with the count of students with unread communications', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      { _id: 's1' },
      { _id: 's2' }
    ]);
    StudentService.getUnreadCommunicationStudents.mockResolvedValue([
      { _id: 's1' }
    ]);
    const res = mockRes();

    await getUnreadNumberMessages(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: 1 });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.findStudentsSelect.mockRejectedValue(err);
    const next = jest.fn();

    await getUnreadNumberMessages(mockReq({ user: admin }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getMyMessages', () => {
  it('staff: responds with the sorted students + the user', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([{ _id: 's1' }]);
    const sorted = [{ _id: 's1', latest: 'm1' }];
    StudentService.getStudentsWithLatestCommunicationSorted.mockResolvedValue(
      sorted
    );
    const res = mockRes();

    await getMyMessages(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.students).toEqual(sorted);
    expect(body.data.user).toBe(admin);
  });
});

describe('loadMessages', () => {
  it('responds with the reversed thread page and the student', async () => {
    const studentDoc = { _id: studentId, firstname: 'Ann' };
    StudentService.getStudentByIdSelectPopulated.mockResolvedValue(studentDoc);
    const thread = [{ _id: 'm1' }, { _id: 'm2' }];
    CommunicationService.findThreadPopulated.mockResolvedValue(thread);
    const res = mockRes();

    await loadMessages(
      mockReq({ params: { studentId, pageNumber: '1' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    // Controller reverses the thread before sending.
    expect(body.data).toEqual([...thread].reverse());
    expect(body.student).toBe(studentDoc);
  });

  it('forwards a 404 ErrorResponse to next() when the student is missing', async () => {
    StudentService.getStudentByIdSelectPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await loadMessages(
      mockReq({ params: { studentId, pageNumber: '1' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('getMessages', () => {
  it('responds with the (empty) thread + student when there are no messages', async () => {
    const studentDoc = { _id: studentId, firstname: 'Ann' };
    StudentService.getStudentByIdSelectPopulated.mockResolvedValue(studentDoc);
    CommunicationService.findThreadPopulated.mockResolvedValue([]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(CommunicationService.findThreadPopulated).toHaveBeenCalledWith(
      studentId,
      expect.any(Object)
    );
  });

  it('forwards a 404 ErrorResponse to next() when the student is missing', async () => {
    StudentService.getStudentByIdSelectPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await getMessages(
      mockReq({ user: admin, params: { studentId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('postMessages', () => {
  it('creates a message and responds with the latest thread entry', async () => {
    CommunicationService.createCommunication.mockResolvedValue({ _id: 'new1' });
    const latest = [{ _id: 'new1', message: validMessage }];
    CommunicationService.findThreadPopulated.mockResolvedValue(latest);
    StudentService.getStudentById.mockResolvedValue({
      _id: studentId,
      agents: [],
      firstname: 'Ann',
      lastname: 'Smith',
      email: 'a@b.co'
    });
    const res = mockRes();

    await postMessages(
      mockReq({
        user: admin,
        params: { studentId },
        body: { message: validMessage }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: latest });
    expect(CommunicationService.createCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ student_id: studentId, message: validMessage })
    );
  });

  it('forwards a 400 ErrorResponse to next() for a non-JSON message body', async () => {
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: admin,
        params: { studentId },
        body: { message: 'not-json' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(CommunicationService.createCommunication).not.toHaveBeenCalled();
  });
});

describe('updateAMessageInThread', () => {
  it('updates the message and forwards id + body', async () => {
    const updated = { _id: messageId, message: 'new information' };
    CommunicationService.updateCommunication.mockResolvedValue(updated);
    const res = mockRes();

    await updateAMessageInThread(
      mockReq({
        params: { messageId },
        body: { message: 'new information' }
      }),
      res,
      jest.fn()
    );

    expect(CommunicationService.updateCommunication).toHaveBeenCalledWith(
      messageId,
      { message: 'new information' }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });
});

describe('deleteAMessageInCommunicationThread', () => {
  it('deletes the message and forwards the id', async () => {
    CommunicationService.getCommunicationById.mockResolvedValue({
      _id: messageId,
      student_id: studentId,
      files: []
    });
    CommunicationService.deleteById.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteAMessageInCommunicationThread(
      mockReq({ params: { messageId } }),
      res,
      jest.fn()
    );

    expect(CommunicationService.deleteById).toHaveBeenCalledWith(messageId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});

describe('IgnoreMessage', () => {
  it('forwards the ignore state to the service and responds 200', async () => {
    CommunicationService.updateCommunication.mockResolvedValue(undefined);
    const res = mockRes();

    await IgnoreMessage(
      mockReq({
        user: admin,
        params: {
          communication_messageId: messageId,
          ignoreMessageState: 'true'
        }
      }),
      res,
      jest.fn()
    );

    expect(CommunicationService.updateCommunication).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({ ignore_message: 'true' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});
