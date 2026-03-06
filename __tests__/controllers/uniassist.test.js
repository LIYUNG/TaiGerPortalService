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

const { ObjectId } = require('mongoose').Types;
const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agent, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');
const { applicationSchema } = require('../../models/Application');
const { programSchema } = require('../../models/Program');
const { generateProgram } = require('../fixtures/faker');

const requestWithSupertest = request(app);
let dbUri;

const program1 = generateProgram();

const testApplication = {
  _id: new ObjectId().toHexString(),
  studentId: student._id,
  programId: program1._id,
  closed: '-',
  decided: '-'
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
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await ApplicationModel.deleteMany();
  await ProgramModel.deleteMany();

  await UserModel.insertMany(users);
  await ProgramModel.insertMany([program1]);
  await ApplicationModel.insertMany([testApplication]);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('getStudentUniAssist Controller', () => {
  it(`GET /api/uniassist/:studentId should return 200 with student data`, async () => {
    const resp = await requestWithSupertest
      .get(`/api/uniassist/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});
