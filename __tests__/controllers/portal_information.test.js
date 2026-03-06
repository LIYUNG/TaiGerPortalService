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
    permit: jest.fn().mockImplementation((...roles) => passthrough),
    prohibit: jest.fn().mockImplementation((...roles) => passthrough)
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

describe('GET /api/portal-informations/:studentId', () => {
  it('should respond without crash', async () => {
    const resp = await requestWithSupertest
      .get(`/api/portal-informations/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /api/portal-informations/:studentId/:applicationId', () => {
  it('should respond without crash', async () => {
    const resp = await requestWithSupertest
      .post(`/api/portal-informations/${student._id}/${applicationId}`)
      .set('tenantId', TENANT_ID)
      .send({
        account_portal_a: 'test_account_a',
        password_portal_a: 'test_password_a',
        account_portal_b: 'test_account_b',
        password_portal_b: 'test_password_b'
      });

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
  });
});
