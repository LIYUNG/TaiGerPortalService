// Full-stack integration test for the courses routes:
//   supertest -> real router -> real controllers/course -> real CourseService ->
//   real CourseDAO -> in-memory MongoDB (StudentService/StudentDAO too).
//
// Nothing below the route is mocked (only auth/tenant middleware is stubbed).
// This is the layer that catches the seam bugs — schema mismatch, bad query,
// wrong field — that the mocked controller unit test (../controllers/courses.test.js)
// cannot see. Ported from the original __tests__/controllers/courses.test.js
// with the weak assertions strengthened against the deterministic seed. Keep it
// thin: happy paths only.

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
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

describe('GET /api/courses/:studentId (full stack)', () => {
  it('returns the persisted course record for the student', async () => {
    const resp = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.table_data_string).toContain('(Example)微積分一');
  });

  it('returns default example course data when no record exists', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const CourseModel = db.model('Course', coursesSchema);
    await CourseModel.deleteMany({ student_id: student._id });

    const resp = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.table_data_string).toContain('(Example)');
  });
});

describe('PUT /api/courses/:studentId (full stack)', () => {
  it('persists the updated course and the change is visible on a read', async () => {
    const newTable =
      '[{"course_chinese":"電子學一","course_english":"Electronics I","credits":"2","grades":"73"}]';

    const put = await requestWithSupertest
      .put(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ table_data_string: newTable });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(200);
    expect(get.body.data.table_data_string).toContain('電子學一');
  });

  it('upserts (creates) a course record when none exists', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const CourseModel = db.model('Course', coursesSchema);
    await CourseModel.deleteMany({ student_id: student._id });

    const newTable =
      '[{"course_chinese":"新課程","course_english":"New Course","credits":"3","grades":"85"}]';

    const put = await requestWithSupertest
      .put(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ table_data_string: newTable });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(get.body.data.table_data_string).toContain('新課程');
  });
});

describe('DELETE /api/courses/:studentId (full stack)', () => {
  it('deletes the course so a subsequent read returns the default data', async () => {
    const del = await requestWithSupertest
      .delete(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    // No record now -> controller returns the default example payload.
    expect(get.status).toBe(200);
    expect(get.body.data.table_data_string).toContain('(Example)');
  });
});
