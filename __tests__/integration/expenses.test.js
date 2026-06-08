// Full-stack integration layer for the expenses routes:
//   supertest -> real router -> real controllers/expenses -> real services
//   (StudentService/UserService) -> real DAOs -> in-memory MongoDB.
//
// Only auth/tenant/permission middleware is stubbed; everything below the route
// is real, so a seam bug (schema/query/projection) surfaces here. Kept thin —
// the exhaustive per-handler behaviour lives in ../controllers/expenses.test.js
// (mocked) and the service/dao suites.

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

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { expensesSchema } = require('../../models/Expense');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agent, student } = require('../mock/user');
const { generateExpense } = require('../mock/expenses');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);
let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});
afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});
beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const ExpenseModel = db.model('Expense', expensesSchema);
  await UserModel.deleteMany();
  await ExpenseModel.deleteMany();
  await UserModel.insertMany(users);
  await ExpenseModel.insertMany([
    generateExpense({
      studentId: student._id.toString(),
      receiverId: agent._id.toString()
    })
  ]);
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/expenses/ (full stack)', () => {
  it('returns a success envelope with an array of taiger users with expenses', async () => {
    const resp = await requestWithSupertest
      .get('/api/expenses/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/expenses/users/:taiger_user_id (full stack)', () => {
  it('returns the resolved staff user together with their students', async () => {
    const resp = await requestWithSupertest
      .get(`/api/expenses/users/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // The agent is a valid TaiGer staff user, so the controller resolves them
    // and returns a { students, the_user } payload.
    expect(resp.body.data.the_user._id.toString()).toBe(agent._id.toString());
    expect(Array.isArray(resp.body.data.students)).toBe(true);
  });

  it('returns 401 when the target user is not a TaiGer staff member', async () => {
    const resp = await requestWithSupertest
      .get(`/api/expenses/users/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(401);
  });
});
