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

const request = require('supertest');

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough),
    permission_canAssignAgent_filter: jest.fn().mockImplementation(passthrough),
    permission_canAssignEditor_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

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

const StudentDAO = require('../../dao/student.dao');
const UserDAO = require('../../dao/user.dao');
const PermissionDAO = require('../../dao/permission.dao');
const AuditDAO = require('../../dao/audit.dao');
const { protect } = require('../../middlewares/auth');
const { app } = require('../../app');
const { TENANT_ID } = require('../fixtures/constants');
const { admin, agents, editors, student } = require('../mock/user');

const requestWithSupertest = request(app);
const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });

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
    const agents_obj = {};
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
    expect(resp.body.data.agents.map((a) => a._id.toString()).sort()).toEqual(
      expectedAgentIds.sort()
    );
  });
});

describe('POST /api/students/:id/editors (full stack)', () => {
  it('updates the student editors via the DAO with the resolved editor ids', async () => {
    const editors_obj = {};
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
    expect(resp.body.data.editors.map((e) => e._id.toString()).sort()).toEqual(
      expectedEditorIds.sort()
    );
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
