// Integration test for the students routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/students ->
//   real StudentService / UserService / PermissionService / AuditService ->
//   MOCKED StudentDAO / UserDAO / PermissionDAO / AuditDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. Persistence itself is
// covered by the DAO unit tests. The agent/editor assignment handlers send email
// after the upsert; the email senders are stubbed so no SMTP connection opens.
// Fully deterministic — no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/multitenant-filter', () =>
  require('../helpers/middlewareMocks').multitenantFilterMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);

// The agent/editor assignment handlers notify users by email after the upsert;
// stub the senders so no SMTP connection is opened.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  informAgentNewStudentEmail: jest.fn(),
  informAgentManagerNewStudentEmail: jest.fn(),
  informStudentTheirAgentEmail: jest.fn(),
  informEditorNewStudentEmail: jest.fn(),
  informAgentStudentAssignedEmail: jest.fn(),
  informStudentTheirEditorEmail: jest.fn()
}));

// The data boundary: mock the DAOs the students services delegate to.
jest.mock('../../dao/student.dao');
jest.mock('../../dao/user.dao');
jest.mock('../../dao/permission.dao');
jest.mock('../../dao/audit.dao');

import StudentDAOModule from '../../dao/student.dao';
import UserDAOModule from '../../dao/user.dao';
import PermissionDAOModule from '../../dao/permission.dao';
import AuditDAOModule from '../../dao/audit.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agents, editors, student } from '../mock/user';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const UserDAO = UserDAOModule as unknown as MockedDAO;
const PermissionDAO = PermissionDAOModule as unknown as MockedDAO;
const AuditDAO = AuditDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);
const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();

  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );

  // Sensible defaults; individual tests override as needed.
  StudentDAO.getStudentById.mockResolvedValue({
    _id: student._id,
    firstname: student.firstname,
    lastname: student.lastname,
    email: student.email,
    agents: [],
    editors: [],
    archiv: false
  });
  StudentDAO.updateStudentById.mockResolvedValue({});
  UserDAO.getUserByIdSelect.mockResolvedValue(null);
  PermissionDAO.findPermissionsWithUser.mockResolvedValue([]);
  AuditDAO.createAuditLog.mockResolvedValue({});
});

describe('POST /api/students/:id/agents (full stack)', () => {
  it('updates the student agents via the DAO with the resolved agent ids', async () => {
    const agents_obj: Record<string, boolean> = {};
    agents.forEach((ag) => {
      agents_obj[ag._id] = true;
    });

    // Each toggled agent is resolved through the user DAO.
    agents.forEach((ag) => {
      UserDAO.getUserByIdSelect.mockResolvedValueOnce({
        _id: ag._id,
        firstname: ag.firstname,
        lastname: ag.lastname,
        email: ag.email,
        archiv: false
      });
    });

    // Re-fetch after update returns the student with the new agents.
    StudentDAO.getStudentById
      .mockResolvedValueOnce({
        _id: student._id,
        firstname: student.firstname,
        lastname: student.lastname,
        email: student.email,
        agents: [],
        editors: [],
        archiv: false
      })
      .mockResolvedValueOnce({
        _id: student._id,
        firstname: student.firstname,
        lastname: student.lastname,
        email: student.email,
        agents: agents.map((ag) => ({ _id: ag._id })),
        editors: [],
        archiv: false
      });

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/agents`)
      .set('tenantId', TENANT_ID)
      .send(agents_obj);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const expectedAgentIds = agents.map((ag) => ag._id.toString());
    expect(StudentDAO.updateStudentById).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        agents: expect.arrayContaining(expectedAgentIds)
      })
    );
    expect(
      resp.body.data.agents
        .map((a: { _id: { toString: () => string } }) => a._id.toString())
        .sort()
    ).toEqual(expectedAgentIds.sort());
  });
});

describe('POST /api/students/:id/editors (full stack)', () => {
  it('updates the student editors via the DAO with the resolved editor ids', async () => {
    const editors_obj: Record<string, boolean> = {};
    editors.forEach((editor) => {
      editors_obj[editor._id] = true;
    });

    editors.forEach((editor) => {
      UserDAO.getUserByIdSelect.mockResolvedValueOnce({
        _id: editor._id,
        firstname: editor.firstname,
        lastname: editor.lastname,
        email: editor.email,
        archiv: false
      });
    });

    StudentDAO.getStudentById
      .mockResolvedValueOnce({
        _id: student._id,
        firstname: student.firstname,
        lastname: student.lastname,
        email: student.email,
        agents: [],
        editors: [],
        archiv: false
      })
      .mockResolvedValueOnce({
        _id: student._id,
        firstname: student.firstname,
        lastname: student.lastname,
        email: student.email,
        agents: [],
        editors: editors.map((editor) => ({ _id: editor._id })),
        archiv: false
      });

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/editors`)
      .set('tenantId', TENANT_ID)
      .send(editors_obj);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const expectedEditorIds = editors.map((editor) => editor._id.toString());
    expect(StudentDAO.updateStudentById).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        editors: expect.arrayContaining(expectedEditorIds)
      })
    );
    expect(
      resp.body.data.editors
        .map((e: { _id: { toString: () => string } }) => e._id.toString())
        .sort()
    ).toEqual(expectedEditorIds.sort());
  });
});

describe('GET /api/students/:studentId (full stack)', () => {
  it('returns the student the DAO looks up by id', async () => {
    StudentDAO.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: student.firstname,
      lastname: student.lastname
    });

    const resp = await requestWithSupertest
      .get(`/api/students/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(studentId);
    expect(StudentDAO.getStudentById).toHaveBeenCalledWith(studentId);
  });

  it('404s when the DAO finds no student', async () => {
    StudentDAO.getStudentById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/students/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});
