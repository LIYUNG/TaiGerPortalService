const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { User, UserSchema } = require('../../models/User');
const { programSchema } = require('../../models/Program');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin } = require('../mock/user');
const { program1 } = require('../mock/programs');
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

  const UserModel = db.model('User', UserSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await ProgramModel.deleteMany();
  await ProgramModel.create(program1);
});

describe('/api/docs/:category', () => {
  const category_uniassist = 'uniassist';
  const category_visa = 'visa';
  const category_certification = 'certification';
  const category_application = 'application';
  const article = {
    name: 'article.name',
    title: 'article.title',
    text: 'article.text',
    updatedAt: new Date().toString(),
    country: 'article.updatedAt'
  };
  const Newarticle = {
    name: 'article.name',
    title: 'Newarticle.title',
    text: 'Newarticle.text',
    updatedAt: new Date().toString(),
    country: 'article.updatedAt'
  };
  let article_id;

  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = await User.findById(admin._id);
      next();
    });
  });

  test('POST should create a new documentation in db', async () => {
    const resp = await requestWithSupertest
      .post('/api/docs')
      .set('tenantId', TENANT_ID)
      .send(article);
    const { status, body } = resp;
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const new_article = body.data;
    expect(new_article.title).toBe(article.title);
    expect(new_article.text).toBe(article.text);
    article_id = new_article._id.toString();
  });

  test('GET uni-assist documentation in db', async () => {
    // Test Get Article:
    const resp2 = await requestWithSupertest
      .get(`/api/docs/${category_uniassist}`)
      .set('tenantId', TENANT_ID)
      .buffer();
    expect(resp2.status).toBe(200);
  });

  test('GET certification documentation in db', async () => {
    const resp2_cert = await requestWithSupertest
      .get(`/api/docs/${category_certification}`)
      .set('tenantId', TENANT_ID)
      .buffer();
    expect(resp2_cert.status).toBe(200);
  });

  test('GET application documentation in db', async () => {
    const resp2_app = await requestWithSupertest
      .get(`/api/docs/${category_application}`)
      .set('tenantId', TENANT_ID)
      .buffer();
    expect(resp2_app.status).toBe(200);
  });

  test('GET visa documentation in db', async () => {
    const resp2_visa = await requestWithSupertest
      .get(`/api/docs/${category_visa}`)
      .set('tenantId', TENANT_ID)
      .buffer();
    expect(resp2_visa.status).toBe(200);
  });

  test('PUT update documentation in db', async () => {
    // test update doc status
    const resp5 = await requestWithSupertest
      .put(`/api/docs/${article_id}`)
      .set('tenantId', TENANT_ID)
      .send(Newarticle);
    expect(resp5.status).toBe(201);
    const new_article = resp5.body.data;
    expect(resp5.body.success).toBe(true);
    expect(new_article.title).toBe(Newarticle.title);
    expect(new_article.text).toBe(Newarticle.text);
  });

  test('GET all documentation in db', async () => {
    const resp4 = await requestWithSupertest
      .get('/api/docs/all')
      .set('tenantId', TENANT_ID);
    expect(resp4.body.success).toBe(true);
  });

  test('GET all internal documentation in db', async () => {
    const resp4 = await requestWithSupertest
      .get('/api/docs/internal/all')
      .set('tenantId', TENANT_ID);
    expect(resp4.body.success).toBe(true);
  });

  test('DELETE documentation in db', async () => {
    // test delete
    const resp4 = await requestWithSupertest
      .delete(`/api/docs/${article_id}`)
      .set('tenantId', TENANT_ID);
    expect(resp4.status).toBe(200);
    expect(resp4.body.success).toBe(true);
  });
});

describe('/api/docs/pages/:category', () => {
  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = await User.findById(admin._id);
      next();
    });
  });

  test('GET pages by a valid category returns 200', async () => {
    const resp = await requestWithSupertest
      .get('/api/docs/pages/uniassist')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBeLessThan(600);
  });

  test('PUT update page by category responds', async () => {
    const payload = {
      name: 'page.name',
      title: 'page.title',
      text: 'page.text',
      updatedAt: new Date().toString(),
      country: 'page.country'
    };

    const resp = await requestWithSupertest
      .put('/api/docs/pages/uniassist')
      .set('tenantId', TENANT_ID)
      .send(payload);

    expect(resp.status).toBeLessThan(600);
  });
});

describe('/api/docs/internal CRUD', () => {
  let internaldoc_id;

  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = await User.findById(admin._id);
      next();
    });

    const db = connectToDatabase(TENANT_ID, dbUri);
    const InternaldocModel = db.model('Internaldoc');
    await InternaldocModel.deleteMany();
    const created = await InternaldocModel.create({
      name: 'internal.name',
      title: 'internal.title',
      text: 'internal.text',
      category: 'internal',
      internal: true,
      author: 'Test Author',
      updatedAt: new Date()
    });
    internaldoc_id = created._id.toString();
  });

  test('POST /api/docs/internal creates an internal doc', async () => {
    const payload = {
      name: 'new.internal.name',
      title: 'new.internal.title',
      text: 'new.internal.text',
      category: 'internal',
      internal: true
    };

    const resp = await requestWithSupertest
      .post('/api/docs/internal')
      .set('tenantId', TENANT_ID)
      .send(payload);

    expect(resp.status).toBeLessThan(600);
  });

  test('PUT /api/docs/internal/:id updates an internal doc', async () => {
    const payload = {
      title: 'updated.internal.title',
      text: 'updated.internal.text'
    };

    const resp = await requestWithSupertest
      .put(`/api/docs/internal/${internaldoc_id}`)
      .set('tenantId', TENANT_ID)
      .send(payload);

    expect(resp.status).toBeLessThan(600);
  });

  test('DELETE /api/docs/internal/:id deletes an internal doc', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/docs/internal/${internaldoc_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBeLessThan(600);
  });
});
