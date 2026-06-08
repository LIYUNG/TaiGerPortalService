// Integration test for the expenses routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/expenses ->
//   real StudentService / UserService -> MOCKED StudentDAO / UserDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. Fully deterministic —
// no engine flake.

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
jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
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

// The data boundary: mock the DAOs the student/user services delegate to.
jest.mock('../../dao/student.dao');
jest.mock('../../dao/user.dao');

const request = require('supertest');
const StudentDAO = require('../../dao/student.dao');
const UserDAO = require('../../dao/user.dao');
const { app } = require('../../app');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { admin, agent, student } = require('../mock/user');

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/expenses/', () => {
  it('returns a success envelope with the taiger-users-with-expenses array from the DAO', async () => {
    StudentDAO.getTaigerUsersWithExpenses.mockResolvedValue([
      { _id: agent._id }
    ]);

    const resp = await requestWithSupertest
      .get('/api/expenses/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(StudentDAO.getTaigerUsersWithExpenses).toHaveBeenCalled();
  });
});

describe('GET /api/expenses/users/:taiger_user_id', () => {
  it('returns the resolved staff user together with their students', async () => {
    UserDAO.getUserById.mockResolvedValue(agent);
    StudentDAO.getStudentsWithExpenses.mockResolvedValue([]);
    StudentDAO.getStudentsForExpenses.mockResolvedValue([{ _id: student._id }]);

    const resp = await requestWithSupertest
      .get(`/api/expenses/users/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // The agent is a valid TaiGer staff user, so the controller resolves them
    // and returns a { students, the_user } payload.
    expect(resp.body.data.the_user._id.toString()).toBe(agent._id.toString());
    expect(Array.isArray(resp.body.data.students)).toBe(true);
    expect(UserDAO.getUserById).toHaveBeenCalledWith(agent._id.toString());
    expect(StudentDAO.getStudentsForExpenses).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id.toString() })
    );
  });

  it('returns 401 when the target user is not a TaiGer staff member', async () => {
    UserDAO.getUserById.mockResolvedValue(student);

    const resp = await requestWithSupertest
      .get(`/api/expenses/users/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(401);
    expect(StudentDAO.getStudentsForExpenses).not.toHaveBeenCalled();
  });
});
