// Full-stack integration layer for the portal-informations routes:
//   supertest -> real router -> real controllers/portal_informations -> real
//   StudentService/ApplicationService -> real DAOs -> in-memory MongoDB.
//
// Only auth/tenant/permission middleware is stubbed; everything below the route
// is real, so a seam bug (schema/query/nested-update) surfaces here. Kept thin —
// exhaustive per-handler behaviour lives in ../controllers/portal_information.test.js
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
    permit: jest.fn().mockImplementation(() => passthrough),
    prohibit: jest.fn().mockImplementation(() => passthrough)
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
const { ObjectId } = require('mongoose').Types;
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { applicationSchema } = require('../../models/Application');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);
let dbUri;

const applicationId = new ObjectId().toHexString();
const testApplication = {
  _id: applicationId,
  studentId: student._id,
  programId: new ObjectId().toHexString(),
  decided: '-',
  closed: '-',
  doc_modification_thread: []
};

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
  const ApplicationModel = db.model('Application', applicationSchema);
  await UserModel.deleteMany();
  await ApplicationModel.deleteMany();
  await UserModel.insertMany(users);
  await ApplicationModel.insertMany([testApplication]);
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/portal-informations/:studentId (full stack)', () => {
  it('returns the student together with their applications', async () => {
    const resp = await requestWithSupertest
      .get(`/api/portal-informations/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.student._id.toString()).toBe(student._id.toString());
    expect(Array.isArray(resp.body.data.applications)).toBe(true);
  });
});

describe('POST /api/portal-informations/:studentId/:applicationId (full stack)', () => {
  it('persists portal credentials onto the application', async () => {
    const post = await requestWithSupertest
      .post(`/api/portal-informations/${student._id}/${applicationId}`)
      .set('tenantId', TENANT_ID)
      .send({
        account_portal_a: 'test_account_a',
        password_portal_a: 'test_password_a',
        account_portal_b: 'test_account_b',
        password_portal_b: 'test_password_b'
      });

    expect(post.status).toBe(200);
    expect(post.body.success).toBe(true);
    // NOTE: portal_credentials.*.account/password are `select: false` in the
    // shared application schema. updateApplication's findOneAndUpdate does NOT
    // add a `+portal_credentials...` projection, so the POST response omits the
    // (just-persisted) credentials. We therefore assert persistence through the
    // GET path below, which DOES select them in (getApplicationsWithCredentialsByStudentId).
    expect(post.body.data._id.toString()).toBe(applicationId);

    // The credentials are returned to the student via getPortalCredentials.
    const get = await requestWithSupertest
      .get(`/api/portal-informations/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(200);
    const persisted = get.body.data.applications.find(
      (a) => a._id.toString() === applicationId
    );
    expect(persisted.portal_credentials.application_portal_a.account).toBe(
      'test_account_a'
    );
  });

  it('returns 400 when the application does not exist', async () => {
    const resp = await requestWithSupertest
      .post(
        `/api/portal-informations/${
          student._id
        }/${new ObjectId().toHexString()}`
      )
      .set('tenantId', TENANT_ID)
      .send({ account_portal_a: 'x', password_portal_a: 'y' });

    expect(resp.status).toBe(400);
  });
});
