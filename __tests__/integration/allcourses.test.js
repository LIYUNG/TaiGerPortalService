// Full-stack integration test for the all-courses routes:
//   supertest -> real router -> real controllers/allcourses -> real
//   AllcourseService -> real AllcourseDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant middleware is stubbed).
// This is the layer that catches the seam bugs the mocked controller unit test
// (../controllers/allcourses.test.js) cannot see. Kept thin: happy paths only,
// asserting real persisted data.

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

describe('GET /api/all-courses (full stack)', () => {
  it('returns all seeded courses as an array', async () => {
    const resp = await requestWithSupertest
      .get('/api/all-courses/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(subjects.length);
  });
});

describe('POST /api/all-courses (full stack)', () => {
  it('creates a course and persists it (visible on a subsequent list)', async () => {
    const resp = await requestWithSupertest
      .post('/api/all-courses/')
      .set('tenantId', TENANT_ID)
      .send({
        all_course_chinese: '測試',
        all_course_english: 'test'
      });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.all_course_english).toBe('test');

    const list = await requestWithSupertest
      .get('/api/all-courses/')
      .set('tenantId', TENANT_ID);
    expect(list.body.data).toHaveLength(subjects.length + 1);
  });

  it('rejects a course missing required names with 400', async () => {
    const resp = await requestWithSupertest
      .post('/api/all-courses/')
      .set('tenantId', TENANT_ID)
      .send({ all_course_english: 'only english' });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});

describe('GET /api/all-courses/:courseId (full stack)', () => {
  it('returns the seeded course by id', async () => {
    const resp = await requestWithSupertest
      .get(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(subject1._id.toString());
  });
});

describe('PUT /api/all-courses/:courseId (full stack)', () => {
  it('updates the course and the change is visible on a subsequent read', async () => {
    const resp = await requestWithSupertest
      .put(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        all_course_chinese: '測試',
        all_course_english: 'updated-english'
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID);
    expect(get.body.data.all_course_english).toBe('updated-english');
  });
});

describe('DELETE /api/all-courses/:courseId (full stack)', () => {
  it('deletes the course so it is no longer found', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/all-courses/${subject3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/all-courses/${subject3._id}`)
      .set('tenantId', TENANT_ID);
    expect(get.status).toBe(404);
  });
});
