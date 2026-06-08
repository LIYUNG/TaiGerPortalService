// Full-stack integration test for the course-keywords routes:
//   supertest -> real router -> real controllers/coursekeywords ->
//   real KeywordSetService -> real KeywordSetDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant middleware is stubbed).
// This is the layer that catches the seam bugs — schema mismatch, bad query,
// wrong field — that the mocked controller unit test
// (../controllers/coursekeywords.test.js) cannot see. Ported from the original
// __tests__/controllers/coursekeywords.test.js with the weak assertions
// strengthened against the deterministic seed. Keep it thin: happy paths only.

const request = require('supertest');
const { keywordSetSchema } = require('@taiger-common/model');

const { protect } = require('../../middlewares/auth');
const { connect, clearDatabase } = require('../fixtures/db');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { TENANT_ID } = require('../fixtures/constants');
const { subjects, subject1, subject2 } = require('../mock/allcourses');
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

  const keywordSetModel = db.model('KeywordSet', keywordSetSchema);

  await keywordSetModel.deleteMany();
  await keywordSetModel.insertMany(subjects);

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
});

describe('GET /api/course-keywords (full stack)', () => {
  it('returns all seeded keyword sets', async () => {
    const resp = await requestWithSupertest
      .get('/api/course-keywords/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(subjects.length);
  });
});

describe('GET /api/course-keywords/:keywordsSetId (full stack)', () => {
  it('returns the persisted keyword set for the requested id', async () => {
    const resp = await requestWithSupertest
      .get(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(subject1._id.toString());
  });
});

describe('POST /api/course-keywords/:keywordsSetId (full stack)', () => {
  it('creates a new keyword set and returns it', async () => {
    const resp = await requestWithSupertest
      .post(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        categoryName: 'categoryName_new',
        description: 'keyowrd_description',
        keywords: { zh: ['123'], en: ['abc'] },
        antiKeywords: { zh: ['123'], en: ['abc'] }
      });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.categoryName).toBe('categoryName_new');
  });
});

describe('PUT /api/course-keywords/:keywordsSetId (full stack)', () => {
  it('updates the keyword set and the change is persisted', async () => {
    const put = await requestWithSupertest
      .put(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ categoryName: 'categoryName_updated' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.data.categoryName).toBe('categoryName_updated');

    const get = await requestWithSupertest
      .get(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(get.body.data.categoryName).toBe('categoryName_updated');
  });
});

describe('DELETE /api/course-keywords/:keywordsSetId (full stack)', () => {
  it('deletes the keyword set so a subsequent read 404s', async () => {
    const del = await requestWithSupertest
      .delete(`/api/course-keywords/${subject2._id}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/course-keywords/${subject2._id}`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(404);
  });
});
