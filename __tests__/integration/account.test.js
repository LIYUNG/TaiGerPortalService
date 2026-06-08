// Full-stack integration test for the account routes:
//   supertest -> real router -> real controllers/account -> real UserService ->
//   real UserDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant/permission middleware is
// stubbed). This is the layer that catches the seam bugs (schema / nested
// academic_background paths / document-status side effects) the mocked
// controller unit test (../controllers/account.test.js) cannot see. Kept thin:
// happy paths only, asserting real persisted data.

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, student } = require('../mock/user');
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
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
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
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = student;
    next();
  });
});

describe('POST /api/account/credentials (full stack)', () => {
  it('updates the user password and reports success', async () => {
    const resp = await requestWithSupertest
      .post('/api/account/credentials')
      .set('tenantId', TENANT_ID)
      .send({ credentials: { new_password: 'somepassword' } });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  it('returns 400 when the authenticated user is not found', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = { _id: '012345678901234567891234' };
      next();
    });

    const resp = await requestWithSupertest
      .post('/api/account/credentials')
      .set('tenantId', TENANT_ID)
      .send({ credentials: { new_password: 'somepassword' } });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});

describe('POST /api/account/profile/:user_id (full stack)', () => {
  it('persists personal data and echoes the whitelisted fields back', async () => {
    const personaldata = {
      firstname: 'New_FirstName',
      lastname: 'New_LastName'
    };

    const resp = await requestWithSupertest
      .post(`/api/account/profile/${student._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ personaldata });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.firstname).toBe('New_FirstName');
    expect(resp.body.data.lastname).toBe('New_LastName');
  });
});

describe('POST /api/account/survey/language/:studentId (full stack)', () => {
  const language = {
    english_certificate: 'TOEFL',
    english_score: '95',
    english_test_date: '',
    german_certificate: '',
    german_score: '',
    german_test_date: ''
  };

  it('persists the language block and returns it', async () => {
    const resp = await requestWithSupertest
      .post(`/api/account/survey/language/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ language });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.english_certificate).toBe('TOEFL');
    expect(resp.body.data.english_score).toBe('95');
    expect(resp.body.data.german_certificate).toBe('');
  });
});

describe('POST /api/account/survey/university/:studentId (full stack)', () => {
  const university = {
    attended_university: 'National Chiao Tung University',
    attended_university_program: 'Electronics Engineering',
    isGraduated: 'No'
  };

  it('persists the academic background and is visible on a subsequent survey read', async () => {
    const resp = await requestWithSupertest
      .post(`/api/account/survey/university/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ university });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.attended_university).toBe(
      'National Chiao Tung University'
    );
    expect(resp.body.data.attended_university_program).toBe(
      'Electronics Engineering'
    );
    expect(resp.body.data.isGraduated).toBe('No');

    const survey = await requestWithSupertest
      .get('/api/account/survey')
      .set('tenantId', TENANT_ID);

    expect(survey.status).toBe(200);
    const { university: persisted } = survey.body.data.academic_background;
    expect(persisted.attended_university).toBe(
      'National Chiao Tung University'
    );
    expect(persisted.attended_university_program).toBe(
      'Electronics Engineering'
    );
    expect(persisted.isGraduated).toBe('No');
  });
});
