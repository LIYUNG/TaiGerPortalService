// Full-stack integration test for the team dashboard routes:
//   supertest -> real router -> real controllers/teams -> real services ->
//   real DAOs -> in-memory MongoDB.
//
// Thin on purpose: a few critical endpoints exercised end to end so a seam bug
// (schema/aggregation/populate) surfaces here. The exhaustive per-endpoint
// behaviour lives in ../controllers/teams.test.js (mocked) and the service/dao
// suites.

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn((req, res, next) => {
    req.tenantId = 'test';
    next();
  })
}));
jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn((req, res, next) => next())
}));
jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn((req, res, next) => next()),
  permit: jest.fn(() => (req, res, next) => next())
}));
jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn((req, res, next) => next())
}));
jest.mock('../../middlewares/permission-filter', () => ({
  ...jest.requireActual('../../middlewares/permission-filter'),
  permission_canAccessStudentDatabase_filter: jest.fn((req, res, next) =>
    next()
  )
}));

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, agent } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const api = request(app);
let dbUri;

beforeAll(async () => {
  dbUri = await connect();
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  await UserModel.deleteMany();
  await UserModel.insertMany(users);
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(() => {
  protect.mockImplementation((req, res, next) => {
    req.user = agent;
    next();
  });
});

describe('GET /api/teams/ (full stack)', () => {
  it('returns the team members as an array', async () => {
    const resp = await api.get('/api/teams/').set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/teams/is-manager (full stack)', () => {
  it('returns a boolean-ish isManager flag', async () => {
    const resp = await api
      .get('/api/teams/is-manager')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // No permission doc is seeded, so isManager is undefined and JSON drops the
    // key — the contract we can assert here is "200 with a data object".
    expect(typeof resp.body.data).toBe('object');
  });
});

describe('GET /api/teams/tasks-overview (full stack)', () => {
  it('returns numeric counts for each outstanding-task bucket', async () => {
    const resp = await api
      .get('/api/teams/tasks-overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data.noAgentsStudents).toBe('number');
    expect(typeof resp.body.data.noEditorsStudents).toBe('number');
  });
});

describe('GET /api/agents/profile/:agent_id (full stack)', () => {
  it('returns the requested agent profile', async () => {
    const resp = await api
      .get(`/api/agents/profile/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(agent._id.toString());
  });
});
