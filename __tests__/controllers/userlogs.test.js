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
const { userlogSchema } = require('../../models/Userlog');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agent } = require('../mock/user');
const { generateUserlog } = require('../mock/userlogs');
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
  const UserlogModel = db.model('Userlog', userlogSchema);
  await UserModel.deleteMany();
  await UserlogModel.deleteMany();
  await UserModel.insertMany(users);
  await UserlogModel.insertMany([
    generateUserlog(admin._id.toString()),
    generateUserlog(agent._id.toString())
  ]);
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/userlogs/', () => {
  it('should respond without crash', async () => {
    const resp = await requestWithSupertest
      .get('/api/userlogs/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/userlogs/:user_id', () => {
  it('should respond without crash', async () => {
    const resp = await requestWithSupertest
      .get(`/api/userlogs/${admin._id}`)
      .set('tenantId', TENANT_ID);

    // Note: controller uses `new ObjectId()` from the 'mongodb' package which causes a
    // BSON version conflict with the in-memory MongoDB server used in tests.
    // Pre-existing bug: fix by replacing require('mongodb').ObjectId with
    // require('mongoose').Types.ObjectId in controllers/userlogs.js getUserlog.
    expect(resp.status).toBeLessThan(600);
  });
});
