const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { interviewsSchema } = require('../../models/Interview');
const { users, admin, student3 } = require('../mock/user');
const { app } = require('../../app');
const { interviews, interview1, interview3 } = require('../mock/interviews');
const { program4 } = require('../mock/programs');
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

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
  const InterviewModel = db.model('Interview', interviewsSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await InterviewModel.deleteMany();
  await InterviewModel.insertMany(interviews);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('POST /api/interviews/create/:program_id/:studentId', () => {
  it('createInterview', async () => {
    const resp = await requestWithSupertest
      .post(`/api/interviews/create/${program4._id}/${student3._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        student_id: student3._id,
        program_id: program4._id,
        interview_date: new Date(),
        interview_description: 'new-interview',
        interviewer: 'Steve Jobs'
      });

    expect(resp.status).toEqual(201);
  });
});

describe('GET /api/interviews/:interview_id', () => {
  it('getInterview', async () => {
    const resp = await requestWithSupertest
      .get(`/api/interviews/${interview1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('PUT /api/interviews/:interview_id', () => {
  it('updateInterview', async () => {
    const resp = await requestWithSupertest
      .put(`/api/interviews/${interview1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        interview_description: 'modified_description'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/interviews/:interview_id', () => {
  it('deleteInterview', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/interviews/${interview3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
