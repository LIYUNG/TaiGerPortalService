const request = require('supertest');

const { connect, closeDatabase, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { generateCourse } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { coursesSchema } = require('../../models/Course');
const { users, student } = require('../mock/user');
const { app } = require('../../app');
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

const course1 = generateCourse(student._id);

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
  const CourseModel = db.model('Course', coursesSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await CourseModel.deleteMany();
  await CourseModel.insertMany([course1]);

  protect.mockImplementation(async (req, res, next) => {
    req.user = await UserModel.findById(student._id);
    next();
  });
});

describe('GET /api/courses/:studentId', () => {
  it('getMycourses', async () => {
    const resp = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.data.table_data_string).toContain('(Example)微積分一');
  });
});

describe('PUT /api/courses/:studentId', () => {
  it('putMycourses', async () => {
    const resp = await requestWithSupertest
      .put(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        table_data_string:
          '[{"course_chinese":"電子學一","course_english":"Electronics I","credits":"2","grades":"73"}]'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/courses/:studentId', () => {
  it('deleteMyCourse', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
