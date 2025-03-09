const request = require('supertest');
const { allCourseSchema } = require('@taiger-common/model');

const { protect } = require('../../middlewares/auth');
const { connect, clearDatabase } = require('../fixtures/db');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { TENANT_ID } = require('../fixtures/constants');
const { subjects, subject1, subject3 } = require('../mock/allcourses');
const { agent } = require('../mock/user');
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
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

  const allCourseModel = db.model('Allcourse', allCourseSchema);

  await allCourseModel.deleteMany();
  await allCourseModel.insertMany(subjects);

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
});

describe('GET /api/all-courses', () => {
  it('getCourses', async () => {
    const resp = await requestWithSupertest
      .get('/api/all-courses/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('POST /api/all-courses', () => {
  it('createCourse', async () => {
    const resp = await requestWithSupertest
      .post('/api/all-courses/')
      .set('tenantId', TENANT_ID)
      .send({
        all_course_chinese: '測試',
        all_course_english: 'test'
      });

    expect(resp.status).toEqual(201);
  });
});

describe('GET /api/all-courses/:courseId', () => {
  it('getCourse', async () => {
    const resp = await requestWithSupertest
      .get(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('PUT /api/all-courses/:courseId', () => {
  it('updateCourse', async () => {
    const resp = await requestWithSupertest
      .put(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        all_course_chinese: '測試',
        all_course_english: 'test'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/all-courses/:courseId', () => {
  it('deleteCourse', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/all-courses/${subject3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
