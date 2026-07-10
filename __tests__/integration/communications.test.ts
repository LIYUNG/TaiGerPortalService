// Integration test for the communications (chat) routes — HTTP boundary down to
// the service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/communications
//   -> real CommunicationService / StudentService -> MOCKED CommunicationDAO /
//   StudentDAO / PermissionDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query construction is covered by the DAO unit tests. Fully deterministic —
// no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { generateCommunicationMessage } from '../fixtures/faker';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agent, student } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.tenantId = 'test';
    next();
  };

  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();

  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/chatMultitenantFilter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();

  return {
    ...jest.requireActual('../../middlewares/chatMultitenantFilter'),
    chatMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles: string[]) => passthrough)
  };
});

// Posting a message notifies the agent/student by email (fire-and-forget after
// the response is sent); stub just those senders so no SMTP connection opens.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  sendAgentNewMessageReminderEmail: jest.fn(),
  sendStudentNewMessageReminderEmail: jest.fn()
}));

// The data boundary: mock the DAOs the communication/student services delegate
// to. PermissionDAO is touched by the cached getPermission() helper.
jest.mock('../../dao/communication.dao');
jest.mock('../../dao/communicationDraft.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/permission.dao');

import CommunicationDAOModule from '../../dao/communication.dao';
import StudentDAOModule from '../../dao/student.dao';
import PermissionDAOModule from '../../dao/permission.dao';
import { app } from '../../app';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const CommunicationDAO = CommunicationDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const PermissionDAO = PermissionDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);
const studentId = student._id.toString();

const messages = [...Array(3)].map(() =>
  generateCommunicationMessage({ studnet_id: student._id, user_id: agent._id })
);

const testMessage =
  '{"time":1709234667356,"blocks":[{"id":"PYUnoHKB47","type":"paragraph","data":{"text":"tes"}}],"version":"2.29.0"}';

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
  // getPermission() reads the permission DAO (cached); default to all-access.
  PermissionDAO.getPermissionByUserId.mockResolvedValue({
    canAccessAllChat: true
  });
});

describe('GET /api/communications/ping/all', () => {
  it('returns a numeric unread-count for the user', async () => {
    StudentDAO.findStudentsSelect.mockResolvedValue([
      { _id: student._id, firstname: 'F', lastname: 'L' }
    ]);
    StudentDAO.getUnreadCommunicationStudents.mockResolvedValue([
      { _id: student._id }
    ]);

    const resp = await requestWithSupertest
      .get('/api/communications/ping/all')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('number');
    expect(resp.body.data).toBe(1);
  });
});

describe('GET /api/communications/:studentId/pages/:pageNumber', () => {
  it('returns the thread page as an array plus the student', async () => {
    StudentDAO.getStudentByIdSelectPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'F',
      lastname: 'L',
      agents: []
    });
    CommunicationDAO.findThreadPopulated.mockResolvedValue([...messages]);

    const resp = await requestWithSupertest
      .get(`/api/communications/${studentId}/pages/1`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.student._id.toString()).toBe(studentId);
    expect(StudentDAO.getStudentByIdSelectPopulated).toHaveBeenCalled();
    expect(CommunicationDAO.findThreadPopulated).toHaveBeenCalled();
  });

  it('404s when the student does not exist', async () => {
    StudentDAO.getStudentByIdSelectPopulated.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/communications/${studentId}/pages/1`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
  });
});

describe('GET /api/communications/:studentId', () => {
  it('returns the thread for the student', async () => {
    StudentDAO.getStudentByIdSelectPopulated.mockResolvedValue({
      _id: student._id,
      firstname: 'F',
      lastname: 'L',
      agents: []
    });
    // Live docs with readBy so the mark-as-read branch is exercised. The newest
    // doc already has the admin in readBy => no .save() needed.
    const thread = messages.map((msg) => ({
      ...msg,
      readBy: [{ _id: admin._id }],
      save: jest.fn()
    }));
    CommunicationDAO.findThreadPopulated.mockResolvedValue(thread);

    const resp = await requestWithSupertest
      .get(`/api/communications/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(messages.length);
  });
});

describe('PUT /api/communications/:studentId/:messageId', () => {
  it('updates a message and returns the DAO result', async () => {
    const messageId = messages[0]._id.toString();
    CommunicationDAO.updateCommunication.mockResolvedValue({
      _id: messageId,
      message: 'new information'
    });

    const resp = await requestWithSupertest
      .put(`/api/communications/${studentId}/${messageId}`)
      .set('tenantId', TENANT_ID)
      .send({ message: 'new information' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.message).toContain('new information');
    expect(CommunicationDAO.updateCommunication).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({ message: 'new information' })
    );
  });
});

describe('POST /api/communications/:studentId', () => {
  it('creates a message then returns the latest thread entry', async () => {
    CommunicationDAO.createCommunication.mockResolvedValue({ _id: 'new' });
    CommunicationDAO.findThreadPopulated.mockResolvedValue([
      { _id: 'new', message: testMessage }
    ]);
    // Post-response email fan-out reads the student.
    StudentDAO.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'F',
      lastname: 'L',
      email: 'f@l.com',
      agents: [],
      archiv: false
    });

    const resp = await requestWithSupertest
      .post(`/api/communications/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ message: testMessage });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(CommunicationDAO.createCommunication).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: studentId,
        message: testMessage
      })
    );
  });
});

describe('DELETE /api/communications/:studentId/:messageId', () => {
  it('deletes a message in the thread', async () => {
    const messageId = messages[0]._id.toString();
    // deleteAMessageInCommunicationThread first loads the message (for the file
    // cache/S3 cleanup), then deletes it.
    CommunicationDAO.getCommunicationById.mockResolvedValue({
      _id: messageId,
      student_id: student._id,
      files: []
    });
    CommunicationDAO.deleteById.mockResolvedValue({ deletedCount: 1 });

    const resp = await requestWithSupertest
      .delete(`/api/communications/${studentId}/${messageId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(CommunicationDAO.deleteById).toHaveBeenCalledWith(messageId);
  });
});

describe('PUT /api/communications/:studentId/:messageId/:state/ignore', () => {
  it('marks a message as ignored', async () => {
    const messageId = messages[0]._id.toString();
    CommunicationDAO.updateCommunication.mockResolvedValue({ _id: messageId });

    const resp = await requestWithSupertest
      .put(`/api/communications/${studentId}/${messageId}/true/ignore`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(CommunicationDAO.updateCommunication).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({ ignore_message: 'true' })
    );
  });
});
