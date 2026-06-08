// Full-stack integration test for the users routes:
//   supertest -> real router -> real controllers/users -> real UserService ->
//   real UserDAO -> in-memory MongoDB.
//
// Only auth/tenant middleware and the email/S3 side-effects are stubbed;
// everything below the route runs for real, so a seam bug (schema/query/
// pagination/discriminator) surfaces here. Kept thin (a few critical endpoints)
// — the behaviour matrix lives in ../controllers/users.test.js (mocked) and the
// service/dao suites. Ported from the original controller test with assertions
// strengthened against the seeded data.

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
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

// updateUser sends an email after responding; stub it so no mail transport is
// touched. The user update itself stays fully real.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  updateNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const { Role } = require('@taiger-common/core');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { User, UserSchema } = require('../../models/User');
const { generateUser } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

const admins = [...Array(2)].map(() => generateUser(Role.Admin));
const agents = [...Array(3)].map(() => generateUser(Role.Agent));
const editors = [...Array(3)].map(() => generateUser(Role.Editor));
const students = [...Array(5)].map(() => generateUser(Role.Student));
const guests = [...Array(5)].map(() => generateUser(Role.Guest));
const users = [...admins, ...agents, ...editors, ...students, ...guests];

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
  const UserModel = db.models.User || db.model('User', UserSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admins[0];
    next();
  });
});

describe('GET /api/users (full stack)', () => {
  it('returns every seeded user', async () => {
    const resp = await requestWithSupertest
      .get('/api/users')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(users.length);
  });

  it('paginates the user list', async () => {
    const resp = await requestWithSupertest
      .get('/api/users?page=1&limit=5')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.length).toBe(5);
    expect(resp.body.total).toBe(users.length);
    expect(resp.body.page).toBe(1);
    expect(resp.body.limit).toBe(5);
  });
});

describe('GET /api/users?role=Agent (full stack)', () => {
  it('returns exactly the seeded agents', async () => {
    const resp = await requestWithSupertest
      .get('/api/users?role=Agent')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const agentIds = agents.map(({ _id }) => _id.toString()).sort();
    const receivedIds = resp.body.data.map(({ _id }) => _id.toString()).sort();
    expect(receivedIds).toEqual(agentIds);
  });
});

describe('POST /api/users/:user_id (full stack)', () => {
  it('updates a user role and persists it', async () => {
    const target = students[0];
    const { email } = generateUser(Role.Editor);

    const resp = await requestWithSupertest
      .post(`/api/users/${target._id}`)
      .set('tenantId', TENANT_ID)
      .send({ email, role: Role.Editor });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toMatchObject({ role: Role.Editor, email });

    const updated = await User.findById(target._id);
    expect(updated).toMatchObject({ role: Role.Editor, email });
  });

  it('refuses to promote a user to Admin (409)', async () => {
    const target = guests[0];
    const { email } = generateUser(Role.Admin);

    const resp = await requestWithSupertest
      .post(`/api/users/${target._id}`)
      .set('tenantId', TENANT_ID)
      .send({ email, role: Role.Admin });

    expect(resp.status).toBe(409);
    expect(resp.body.success).toBe(false);
  });
});
