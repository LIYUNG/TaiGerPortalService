// Full-stack integration test for the search routes:
//   supertest -> real router -> real controllers/search -> real SearchService ->
//   real SearchDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant middleware is stubbed).
// This is the layer that catches the seam bugs the mocked controller unit test
// (../controllers/searches.test.js) cannot see. Kept thin: the /students
// endpoint is regex-based and fully deterministic against the seed; the combined
// / endpoint relies on a Mongo $text index whose result ordering is not
// deterministic in-memory, so it asserts only the 200 + success contract.
//
// SearchDAO reads through the central (default-connection) models, which the
// fixtures' connect() points at the same in-memory db that the tenant
// connection uses, so seeded users are visible to the real query.

const passthrough = (req, res, next) => next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn((req, res, next) => {
    req.tenantId = 'test';
    next();
  })
}));
jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn(passthrough)
}));
jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn(passthrough),
  permit: jest.fn(() => passthrough)
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { User } = require('../../models');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const api = request(app);

// A dedicated, regex-safe student so the assertion does not depend on the
// randomly faked names in the `users` fixture (which can produce fragments with
// regex metacharacters / collisions and make the search flaky).
const searchableStudent = {
  _id: new mongoose.Types.ObjectId(),
  firstname: 'Zephyrina',
  lastname: 'Quoridge',
  email: 'zephyrina.quoridge@example.com',
  role: 'Student'
};

beforeAll(async () => {
  await connect();
});
afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});
beforeEach(async () => {
  await User.deleteMany({});
  await User.insertMany([...users, searchableStudent]);
  protect.mockImplementation((req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/search/students (full stack)', () => {
  it('returns the seeded student matching a case-insensitive name fragment', async () => {
    const resp = await api
      .get('/api/search/students')
      .query({ q: 'zephyr' })
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBeGreaterThanOrEqual(1);
    // Only students come back from this endpoint.
    expect(resp.body.data.every((u) => u.role === 'Student')).toBe(true);
    expect(
      resp.body.data.some(
        (u) => u._id.toString() === searchableStudent._id.toString()
      )
    ).toBe(true);
  });

  it('returns an empty array when nothing matches', async () => {
    const resp = await api
      .get('/api/search/students')
      .query({ q: 'zzzznomatchzzzz' })
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual([]);
  });
});

describe('GET /api/search/ (full stack)', () => {
  it('returns a 200 with a (text-index dependent) data array', async () => {
    const resp = await api
      .get('/api/search/')
      .query({ q: 'a' })
      .set('tenantId', TENANT_ID);

    // The controller swallows any error from the $text query and still returns
    // success:true with whatever array the DAO produced — so the deterministic
    // contract here is "200 + success + array", not the contents/ordering.
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});
