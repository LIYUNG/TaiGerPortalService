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
jest.mock('../../services/communicationDraft');
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

import CommunicationService from '../../services/communications';
import CommunicationDraftService from '../../services/communicationDraft';
import StudentService from '../../services/students';
import { ten_minutes_cache } from '../../cache/node-cache';
import {
  getSearchUserMessages,
  getSearchMessageKeywords,
  getUnreadNumberMessages,
  getMyMessages,
  loadMessages,
  getMessages,
  getChatFile,
  postMessages,
  updateAMessageInThread,
  deleteAMessageInCommunicationThread,
  IgnoreMessage,
  getCommunicationDraft,
  upsertCommunicationDraft,
  deleteCommunicationDraft
} from '../../controllers/communications';
import { deleteS3Objects } from '../../aws/s3';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, agent, editor, student } from '../mock/user';

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

describe('getSearchUserMessages', () => {
  it('admin/all-chat: merges aggregate data into the text-search results', async () => {
    StudentService.getStudentsWithLatestCommunication.mockResolvedValue([
      { _id: studentId, latest: 'm1' }
    ]);
    StudentService.searchStudentsByText.mockResolvedValue([
      { _id: studentId, firstname: 'Ann' }
    ]);
    const res = mockRes();

    await getSearchUserMessages(
      mockReq({ user: admin, query: { q: 'ann' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data.students[0]).toMatchObject({
      _id: studentId,
      firstname: 'Ann',
      latest: 'm1'
    });
  });

  it('agent-without-all-chat: scopes the search to the agent', async () => {
    const { getPermission } = require('../../utils/queryFunctions');
    getPermission.mockResolvedValueOnce({ canAccessAllChat: false });
    // Non-empty aggregate with a matching id exercises the merge find-callback.
    StudentService.getStudentsWithLatestCommunication.mockResolvedValue([
      { _id: 'x1', latest: 'm9' }
    ]);
    StudentService.searchStudentsByText.mockResolvedValue([
      { _id: 'x1', firstname: 'Bob' }
    ]);
    const res = mockRes();

    await getSearchUserMessages(
      mockReq({ user: agent, query: { q: 'bob' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(StudentService.searchStudentsByText).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id.toString() }),
      expect.any(String)
    );
  });
});

describe('getSearchMessageKeywords', () => {
  it('admin: returns the active students merged with aggregate data', async () => {
    StudentService.getStudentsWithLatestCommunication.mockResolvedValue([
      { _id: studentId, latest: 'm1' }
    ]);
    StudentService.findStudentsSelect.mockResolvedValue([
      { _id: studentId, firstname: 'Ann' }
    ]);
    const res = mockRes();

    await getSearchMessageKeywords(
      mockReq({ user: admin, query: { q: '' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(StudentService.findStudentsSelect).toHaveBeenCalledTimes(1);
  });

  it('non-admin: scopes the text search to the agent', async () => {
    StudentService.getStudentsWithLatestCommunication.mockResolvedValue([
      { _id: 'a1', latest: 'm2' }
    ]);
    StudentService.searchStudentsByText.mockResolvedValue([
      { _id: 'a1', firstname: 'Cy' }
    ]);
    const res = mockRes();

    await getSearchMessageKeywords(
      mockReq({ user: agent, query: { q: 'foo' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(StudentService.searchStudentsByText).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id.toString() }),
      expect.any(String)
    );
  });
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

  it('agent-without-all-chat: scopes the unread query to the agents filter', async () => {
    const { getPermission } = require('../../utils/queryFunctions');
    getPermission.mockResolvedValueOnce({ canAccessAllChat: false });
    StudentService.findStudentsSelect.mockResolvedValue([{ _id: 's1' }]);
    StudentService.getUnreadCommunicationStudents.mockResolvedValue([]);
    const res = mockRes();

    await getUnreadNumberMessages(mockReq({ user: agent }), res, jest.fn());

    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id.toString() }),
      expect.any(String)
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: 0 });
  });

  it('student: 1 unread when the student is not in the latest message readBy', async () => {
    CommunicationService.getLatestByStudentId.mockResolvedValue({
      readBy: []
    });
    const res = mockRes();

    await getUnreadNumberMessages(mockReq({ user: student }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: 1 });
  });

  it('student: 0 unread when the student is already in readBy', async () => {
    CommunicationService.getLatestByStudentId.mockResolvedValue({
      readBy: [student._id.toString()]
    });
    const res = mockRes();

    await getUnreadNumberMessages(mockReq({ user: student }), res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({ success: true, data: 0 });
  });

  it('forwards a 401 ErrorResponse for an invalid (non-staff, non-student) user', async () => {
    const next = jest.fn();

    await getUnreadNumberMessages(
      mockReq({ user: { ...admin, role: 'Guest' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(401);
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

  it('agent-without-all-chat: scopes the student filter to the agent', async () => {
    const { getPermission } = require('../../utils/queryFunctions');
    getPermission.mockResolvedValueOnce({ canAccessAllChat: false });
    StudentService.findStudentsSelect.mockResolvedValue([{ _id: 's1' }]);
    StudentService.getStudentsWithLatestCommunicationSorted.mockResolvedValue(
      []
    );
    const res = mockRes();

    await getMyMessages(mockReq({ user: agent }), res, jest.fn());

    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: [{ $or: [{ agents: agent._id.toString() }] }]
      }),
      expect.any(String)
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('editor: scopes the student filter to the editor field', async () => {
    const { getPermission } = require('../../utils/queryFunctions');
    getPermission.mockResolvedValueOnce({ canAccessAllChat: false });
    StudentService.findStudentsSelect.mockResolvedValue([{ _id: 's1' }]);
    StudentService.getStudentsWithLatestCommunicationSorted.mockResolvedValue(
      []
    );
    const res = mockRes();

    await getMyMessages(mockReq({ user: editor }), res, jest.fn());

    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: [{ $or: [{ editors: editor._id.toString() }] }]
      }),
      expect.any(String)
    );
    expect(res.status).toHaveBeenCalledWith(200);
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

  it('marks the newest message read when the user is missing from readBy', async () => {
    StudentService.getStudentByIdSelectPopulated.mockResolvedValue({
      _id: studentId
    });
    const latest = {
      _id: 'm1',
      readBy: [],
      timeStampReadBy: {},
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue(undefined)
    };
    CommunicationService.findThreadPopulated.mockResolvedValue([latest]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(latest.save).toHaveBeenCalledTimes(1);
    expect(latest.populate).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not re-save when the user is already in the newest message readBy', async () => {
    StudentService.getStudentByIdSelectPopulated.mockResolvedValue({
      _id: studentId
    });
    const latest = {
      _id: 'm1',
      // admin already present -> isUserNotInReadBy is false; the some() callback
      // runs over a non-empty list.
      readBy: [{ _id: { toString: () => admin._id.toString() } }],
      timeStampReadBy: {},
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue(undefined)
    };
    CommunicationService.findThreadPopulated.mockResolvedValue([latest]);
    const res = mockRes();

    await getMessages(
      mockReq({ user: admin, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(latest.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// Role is enforced at the route by permit(Admin, Manager, Agent, Editor), so
// getMyMessages itself no longer guards the caller role.

describe('getChatFile', () => {
  it('fetches from S3 on a cache miss, then attaches + ends the response', async () => {
    const res = mockRes();
    res.attachment = jest.fn(() => res);

    await getChatFile(
      mockReq({
        params: { studentId, fileName: 'pic.png' },
        originalUrl: `/api/x/y/z/${studentId}/pic.png`
      }),
      res,
      jest.fn()
    );

    expect(res.attachment).toHaveBeenCalledWith('pic.png');
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('serves from the cache on a hit (no S3 fetch)', async () => {
    const { getS3Object } = require('../../aws/s3');
    // Controller derives the cache key from req.originalUrl.split('/')[5].
    const originalUrl = `/api/communication/file/${studentId}/pic.png`;
    const cacheKey = `chat-${studentId}${originalUrl.split('/')[5]}`;
    ten_minutes_cache.set(cacheKey, Buffer.from('cached'));
    const res = mockRes();
    res.attachment = jest.fn(() => res);

    await getChatFile(
      mockReq({
        params: { studentId, fileName: 'pic.png' },
        originalUrl
      }),
      res,
      jest.fn()
    );

    expect(getS3Object).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
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

  it('student: creates a message and emails the active agents', async () => {
    const {
      sendAgentNewMessageReminderEmail
    } = require('../../services/email');
    // fewer than 3 messages => consecutive-limit guard does not trip.
    CommunicationService.findThreadPopulated
      .mockResolvedValueOnce([]) // the limit-3 pre-check read (student branch)
      .mockResolvedValueOnce([{ _id: 'new1' }]); // the latest read after create
    CommunicationService.createCommunication.mockResolvedValue({ _id: 'new1' });
    StudentService.getStudentById.mockResolvedValue({
      _id: studentId,
      firstname: 'Ann',
      lastname: 'Smith',
      agents: [{ firstname: 'Ag', lastname: 'Ent', email: 'ag@e.co' }]
    });
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { studentId },
        body: { message: validMessage }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendAgentNewMessageReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('student: proceeds when one of the last three messages is not by the student', async () => {
    const studentMsg = {
      user_id: { _id: { toString: () => studentId } }
    };
    const agentMsg = {
      user_id: { _id: { toString: () => 'someAgentId' } }
    };
    CommunicationService.findThreadPopulated
      .mockResolvedValueOnce([studentMsg, agentMsg, studentMsg]) // pre-check
      .mockResolvedValueOnce([{ _id: 'new1' }]); // latest after create
    CommunicationService.createCommunication.mockResolvedValue({ _id: 'new1' });
    StudentService.getStudentById.mockResolvedValue({
      _id: studentId,
      firstname: 'Ann',
      lastname: 'Smith',
      agents: []
    });
    const res = mockRes();

    await postMessages(
      mockReq({
        user: student,
        params: { studentId },
        body: { message: validMessage }
      }),
      res,
      jest.fn()
    );

    expect(CommunicationService.createCommunication).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('attaches uploaded files (distinct extensions) to the created message', async () => {
    CommunicationService.createCommunication.mockResolvedValue({ _id: 'new1' });
    CommunicationService.findThreadPopulated.mockResolvedValue([
      { _id: 'new1' }
    ]);
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
        body: { message: validMessage },
        files: [
          { key: `${studentId}/chat/a.pdf`, mimetype: 'application/pdf' },
          { key: `${studentId}/chat/b.docx`, mimetype: 'application/docx' }
        ]
      }),
      res,
      jest.fn()
    );

    expect(CommunicationService.createCommunication).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          { name: 'a.pdf', path: `${studentId}/chat/a.pdf` },
          { name: 'b.docx', path: `${studentId}/chat/b.docx` }
        ]
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards a 423 ErrorResponse when two uploaded files share an extension', async () => {
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: admin,
        params: { studentId },
        body: { message: validMessage },
        files: [
          { key: `${studentId}/chat/a.pdf`, mimetype: 'application/pdf' },
          { key: `${studentId}/chat/b.pdf`, mimetype: 'application/pdf' }
        ]
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(423);
    expect(CommunicationService.createCommunication).not.toHaveBeenCalled();
  });

  it('student: 429 when the last three messages are all by the student', async () => {
    const studentMsg = {
      user_id: { _id: { toString: () => studentId } }
    };
    CommunicationService.findThreadPopulated.mockResolvedValue([
      studentMsg,
      studentMsg,
      studentMsg
    ]);
    const next = jest.fn();

    await postMessages(
      mockReq({
        user: student,
        params: { studentId },
        body: { message: validMessage }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(429);
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

  it('throws (the not-found 404 is re-wrapped to 400) when the service returns null', async () => {
    CommunicationService.updateCommunication.mockResolvedValue(null);
    const next = jest.fn();

    await updateAMessageInThread(
      mockReq({ params: { messageId }, body: { message: 'x' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  it('forwards a 400 ErrorResponse when the update service rejects', async () => {
    CommunicationService.updateCommunication.mockRejectedValue(
      new Error('db down')
    );
    const next = jest.fn();

    await updateAMessageInThread(
      mockReq({ params: { messageId }, body: { message: 'x' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
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

  it('deletes the attached S3 objects when the message has files', async () => {
    CommunicationService.getCommunicationById.mockResolvedValue({
      _id: messageId,
      student_id: studentId,
      files: [{ name: 'a.pdf', path: `${studentId}/chat/a.pdf` }]
    });
    CommunicationService.deleteById.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteAMessageInCommunicationThread(
      mockReq({ params: { messageId } }),
      res,
      jest.fn()
    );

    expect(deleteS3Objects).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 500 ErrorResponse when the S3 delete fails', async () => {
    CommunicationService.getCommunicationById.mockResolvedValue({
      _id: messageId,
      student_id: studentId,
      files: [{ name: 'a.pdf', path: `${studentId}/chat/a.pdf` }]
    });
    deleteS3Objects.mockRejectedValueOnce(new Error('s3 down'));
    const next = jest.fn();

    await deleteAMessageInCommunicationThread(
      mockReq({ params: { messageId } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(500);
    expect(CommunicationService.deleteById).not.toHaveBeenCalled();
  });

  it('forwards a 400 ErrorResponse when deleteById fails', async () => {
    CommunicationService.getCommunicationById.mockResolvedValue({
      _id: messageId,
      student_id: studentId,
      files: []
    });
    CommunicationService.deleteById.mockRejectedValue(new Error('db down'));
    const next = jest.fn();

    await deleteAMessageInCommunicationThread(
      mockReq({ params: { messageId } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
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

  it('forwards a 400 ErrorResponse when the update service rejects', async () => {
    CommunicationService.updateCommunication.mockRejectedValue(
      new Error('db down')
    );
    const next = jest.fn();

    await IgnoreMessage(
      mockReq({
        user: admin,
        params: {
          communication_messageId: messageId,
          ignoreMessageState: 'true'
        }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});

describe('communication drafts', () => {
  it('getCommunicationDraft returns the current user draft for the student', async () => {
    const draft = { _id: 'd1', message: validMessage };
    CommunicationDraftService.getDraft.mockResolvedValue(draft);
    const res = mockRes();

    await getCommunicationDraft(
      mockReq({ user: agent, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(CommunicationDraftService.getDraft).toHaveBeenCalledWith(
      agent._id.toString(),
      studentId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0]).toEqual({ success: true, data: draft });
  });

  it('getCommunicationDraft returns null when there is no draft', async () => {
    CommunicationDraftService.getDraft.mockResolvedValue(null);
    const res = mockRes();

    await getCommunicationDraft(
      mockReq({ user: agent, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.send.mock.calls[0][0]).toEqual({ success: true, data: null });
  });

  it('upsertCommunicationDraft upserts a non-empty draft', async () => {
    const draft = { _id: 'd1', message: validMessage };
    CommunicationDraftService.upsertDraft.mockResolvedValue(draft);
    const res = mockRes();

    await upsertCommunicationDraft(
      mockReq({
        user: agent,
        params: { studentId },
        body: { message: validMessage }
      }),
      res,
      jest.fn()
    );

    expect(CommunicationDraftService.upsertDraft).toHaveBeenCalledWith(
      agent._id.toString(),
      studentId,
      validMessage
    );
    expect(CommunicationDraftService.deleteDraft).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0]).toEqual({ success: true, data: draft });
  });

  it('upsertCommunicationDraft deletes the draft when the message is empty', async () => {
    CommunicationDraftService.deleteDraft.mockResolvedValue({
      deletedCount: 1
    });
    const res = mockRes();

    await upsertCommunicationDraft(
      mockReq({
        user: agent,
        params: { studentId },
        body: { message: '{"blocks":[]}' }
      }),
      res,
      jest.fn()
    );

    expect(CommunicationDraftService.deleteDraft).toHaveBeenCalledWith(
      agent._id.toString(),
      studentId
    );
    expect(CommunicationDraftService.upsertDraft).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0]).toEqual({ success: true, data: null });
  });

  it('deleteCommunicationDraft clears the draft', async () => {
    CommunicationDraftService.deleteDraft.mockResolvedValue({
      deletedCount: 1
    });
    const res = mockRes();

    await deleteCommunicationDraft(
      mockReq({ user: agent, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(CommunicationDraftService.deleteDraft).toHaveBeenCalledWith(
      agent._id.toString(),
      studentId
    );
    expect(res.send.mock.calls[0][0]).toEqual({ success: true });
  });
});
