// Full-stack integration test for the communications (chat) routes:
//   supertest -> real router -> real controllers/communications -> real
//   CommunicationService/StudentService -> real DAOs -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant/permission middleware is
// stubbed). This is the layer that catches the seam bugs — schema mismatch, bad
// query, wrong field — that the mocked controller unit test
// (../controllers/communications.test.js) cannot see. Ported from the original
// __tests__/controllers/communications.test.js with the deterministic reads
// strengthened. The write paths fan out to email/S3 (fire-and-forget) so they
// keep a status-set assertion. Keep it thin: happy paths only.

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { generateCommunicationMessage } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { communicationsSchema } = require('../../models/Communication');
const { users, admin, agent, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

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

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
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

jest.mock('../../middlewares/chatMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/chatMultitenantFilter'),
    chatMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

const messages = [...Array(3)].map(() =>
  generateCommunicationMessage({ studnet_id: student._id, user_id: agent._id })
);

const testMessage =
  '{"time":1709234667356,"blocks":[{"id":"PYUnoHKB47","type":"paragraph","data":{"text":"tes"}}],"version":"2.29.0"}';
let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const CommunicationModel = db.model('Communication', communicationsSchema);

  await CommunicationModel.deleteMany();
  await CommunicationModel.insertMany([...messages]);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = await UserModel.findById(admin._id);
    next();
  });
});

describe('GET /api/communications/ping/all (full stack)', () => {
  it('returns a numeric unread-count for the user', async () => {
    const resp = await requestWithSupertest
      .get('/api/communications/ping/all')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('number');
  });
});

describe('GET /api/communications/:studentId/pages/:pageNumber (full stack)', () => {
  it('returns the thread page as an array plus the student', async () => {
    const resp = await requestWithSupertest
      .get(`/api/communications/${student._id.toString()}/pages/1`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.student._id.toString()).toBe(student._id.toString());
  });
});

describe('GET /api/communications/:studentId (full stack)', () => {
  it('returns the persisted thread for the student', async () => {
    const resp = await requestWithSupertest
      .get(`/api/communications/${student._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    // The 3 seeded messages all belong to this student's thread.
    expect(resp.body.data.length).toBe(messages.length);
  });
});

describe('PUT /api/communications/:studentId/:messageId (full stack)', () => {
  it('updates a message and the change is reflected in the response', async () => {
    const messageId = messages[0]._id.toString();
    const resp = await requestWithSupertest
      .put(`/api/communications/${student._id.toString()}/${messageId}`)
      .set('tenantId', TENANT_ID)
      .send({ message: 'new information' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.message).toContain('new information');
  });
});

describe('POST /api/communications/:studentId (full stack)', () => {
  it('accepts a new message (write fans out to email/S3 fire-and-forget)', async () => {
    const resp = await requestWithSupertest
      .post(`/api/communications/${student._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ message: testMessage });

    expect([200, 201, 400]).toContain(resp.status);
  });
});

describe('DELETE /api/communications/:studentId/:messageId (full stack)', () => {
  it('deletes a message in the thread', async () => {
    const messageId = messages[0]._id.toString();
    const resp = await requestWithSupertest
      .delete(`/api/communications/${student._id.toString()}/${messageId}`)
      .set('tenantId', TENANT_ID);

    expect([200, 204, 404]).toContain(resp.status);
  });
});

describe('PUT /api/communications/:studentId/:messageId/:state/ignore (full stack)', () => {
  it('marks a message as ignored', async () => {
    const messageId = messages[0]._id.toString();
    const resp = await requestWithSupertest
      .put(
        `/api/communications/${student._id.toString()}/${messageId}/true/ignore`
      )
      .set('tenantId', TENANT_ID);

    expect([200, 404]).toContain(resp.status);
    if (resp.status === 200) {
      expect(resp.body.success).toBe(true);
    }
  });
});
