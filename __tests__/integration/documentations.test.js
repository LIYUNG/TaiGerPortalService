// Full-stack integration test for the documentations routes:
//   supertest -> real router -> real controllers/documentations ->
//   real DocumentationService -> real DAOs -> in-memory MongoDB.
//
// Nothing below the route is mocked except auth/tenant middleware, the S3 file
// layer and the multer upload middleware (loading the real file-upload.js calls
// multerS3({ s3 }) at evaluation time, which crashes in tests). This is the
// layer that catches seam bugs — schema mismatch, wrong query — that the mocked
// controller unit test (../controllers/documentations.test.js) cannot see.
// Kept thin: a few critical CRUD paths asserting real persisted data.

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
    permit: jest.fn().mockImplementation((...roles) => passthrough),
    prohibit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canModifyDocs_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/file-upload', () => {
  // Do NOT use jest.requireActual here — loading the real file-upload.js calls
  // multerS3({ s3: s3Client }) at module evaluation time which crashes in tests.
  const passthrough = async (req, res, next) => {
    req.files = [];
    next();
  };
  const passthroughSingle = async (req, res, next) => {
    req.file = undefined;
    next();
  };
  return {
    imageUpload: passthroughSingle,
    admissionUpload: passthroughSingle,
    documentationDocsUpload: passthroughSingle,
    VPDfileUpload: passthrough,
    ProfilefileUpload: passthrough,
    TemplatefileUpload: passthroughSingle,
    MessagesThreadUpload: passthrough,
    MessagesTicketUpload: passthrough,
    MessagesChatUpload: passthrough,
    MessagesImageThreadUpload: passthroughSingle,
    upload: passthroughSingle
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

  protect.mockImplementation(async (req, res, next) => {
    req.user = await User.findById(admin._id);
    next();
  });
});

describe('/api/docs/:category (full stack)', () => {
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

  test('POST creates a documentation and persists its fields', async () => {
    const resp = await requestWithSupertest
      .post('/api/docs')
      .set('tenantId', TENANT_ID)
      .send(article);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    const new_article = resp.body.data;
    expect(new_article.title).toBe(article.title);
    expect(new_article.text).toBe(article.text);
    expect(new_article._id).toBeDefined();
  });

  test('GET uniassist category returns 200 with a success array', async () => {
    const resp = await requestWithSupertest
      .get(`/api/docs/${category_uniassist}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });

  test('GET certification category returns 200', async () => {
    const resp = await requestWithSupertest
      .get(`/api/docs/${category_certification}`)
      .set('tenantId', TENANT_ID);
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  test('GET application category returns 200', async () => {
    const resp = await requestWithSupertest
      .get(`/api/docs/${category_application}`)
      .set('tenantId', TENANT_ID);
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  test('GET visa category returns 200', async () => {
    const resp = await requestWithSupertest
      .get(`/api/docs/${category_visa}`)
      .set('tenantId', TENANT_ID);
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  test('PUT updates a created documentation (201) with the new fields', async () => {
    const created = await requestWithSupertest
      .post('/api/docs')
      .set('tenantId', TENANT_ID)
      .send(article);
    const article_id = created.body.data._id.toString();

    const resp = await requestWithSupertest
      .put(`/api/docs/${article_id}`)
      .set('tenantId', TENANT_ID)
      .send(Newarticle);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.title).toBe(Newarticle.title);
    expect(resp.body.data.text).toBe(Newarticle.text);
  });

  test('GET all documentations returns a success array', async () => {
    const resp = await requestWithSupertest
      .get('/api/docs/all')
      .set('tenantId', TENANT_ID);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });

  test('GET all internal documentations returns a success array', async () => {
    const resp = await requestWithSupertest
      .get('/api/docs/internal/all')
      .set('tenantId', TENANT_ID);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });

  test('DELETE removes a created documentation (200)', async () => {
    const created = await requestWithSupertest
      .post('/api/docs')
      .set('tenantId', TENANT_ID)
      .send(article);
    const article_id = created.body.data._id.toString();

    const resp = await requestWithSupertest
      .delete(`/api/docs/${article_id}`)
      .set('tenantId', TENANT_ID);
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('/api/docs/internal CRUD (full stack)', () => {
  let internaldoc_id;

  beforeEach(async () => {
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

  test('POST /api/docs/internal creates an internal doc (200)', async () => {
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

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.title).toBe(payload.title);
  });

  test('PUT /api/docs/internal/:id updates an internal doc (201)', async () => {
    const payload = {
      title: 'updated.internal.title',
      text: 'updated.internal.text'
    };

    const resp = await requestWithSupertest
      .put(`/api/docs/internal/${internaldoc_id}`)
      .set('tenantId', TENANT_ID)
      .send(payload);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.title).toBe(payload.title);
  });

  test('DELETE /api/docs/internal/:id deletes an internal doc (200)', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/docs/internal/${internaldoc_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});
