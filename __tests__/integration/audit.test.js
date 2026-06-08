// Full-stack integration test for the audit route:
//   supertest -> real router -> real controllers/audit -> real AuditService ->
//   real AuditDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant/permission middleware is
// stubbed). This is the layer that catches the seam bugs (schema / query /
// pagination) the mocked controller unit test (../controllers/audit.test.js)
// cannot see. Kept thin: a couple of paths asserting real persisted data.
const passthrough = async (req, res, next) => next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(async (req, res, next) => {
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

jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn(passthrough)
}));

const request = require('supertest');
const { auditSchema } = require('@taiger-common/model');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
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
  // Audit is a default-connection model (models/index.js). connect() above
  // connected the default mongoose connection to the same in-memory db, so we
  // seed through that connection here.
  const db = connectToDatabase(TENANT_ID, dbUri);
  const AuditModel = db.model('Audit', auditSchema);
  await AuditModel.deleteMany();
  await AuditModel.insertMany([
    { action: 'create' },
    { action: 'update' },
    { action: 'delete' }
  ]);

  protect.mockImplementation(async (req, res, next) => {
    req.user = { role: 'Admin', _id: '012345678901234567891234' };
    next();
  });
});

describe('GET /api/audit (full stack)', () => {
  it('returns the persisted audit logs as an array', async () => {
    const resp = await requestWithSupertest
      .get('/api/audit/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(3);
  });

  it('honours the limit pagination param', async () => {
    const resp = await requestWithSupertest
      .get('/api/audit/?page=1&limit=2')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveLength(2);
  });
});
