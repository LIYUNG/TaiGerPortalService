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

describe('GET /api/course-keywords', () => {
  it('getKeywordSets', async () => {
    const resp = await requestWithSupertest
      .get('/api/course-keywords/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('GET /api/course-keywords/:keywordsSetId', () => {
  it('getKeywordSet', async () => {
    const resp = await requestWithSupertest
      .get(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('POST /api/course-keywords/:keywordsSetId', () => {
  it('createKeywordSet', async () => {
    const resp = await requestWithSupertest
      .post(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        categoryName: 'categoryName_new',
        description: 'keyowrd_description',
        keywords: { zh: ['123'], en: ['abc'] },
        antiKeywords: { zh: ['123'], en: ['abc'] }
      });

    expect(resp.status).toEqual(201);
  });
});

describe('PUT /api/course-keywords/:keywordsSetId', () => {
  it('updateKeywordSet', async () => {
    const resp = await requestWithSupertest
      .put(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        categoryName: 'categoryName_updated'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/course-keywords/:keywordsSetId', () => {
  it('deleteKeywordSet', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/course-keywords/${subject2._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
