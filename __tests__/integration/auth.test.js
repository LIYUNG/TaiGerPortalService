// Full-stack integration test for the auth routes:
//   supertest -> real router -> real localAuth/passport (jwt+local strategies)
//   -> real controllers/auth -> real UserService/TokenService -> real DAOs ->
//   in-memory MongoDB.
//
// Only the email module and the tenant/cookie middleware are stubbed; the
// passport authentication and the service/dao layers run for real so a seam bug
// (password compare, token lookup, user projection) surfaces here. Ported from
// the original __tests__/controllers/auth.test.js with the login assertions
// strengthened against the deterministic seed. Keep it thin: happy paths only.

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, student, admin } = require('../mock/user');
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
    // protect is stubbed (the verify route is not under test here); localAuth is
    // kept REAL so the login password compare runs against the seeded user.
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../services/email', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendForgotPasswordEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountActivationConfirmationEmail: jest.fn().mockResolvedValue(undefined)
}));

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

  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = await UserModel.findById(student._id);
    next();
  });
});

describe('POST /auth/login (full stack)', () => {
  it('401: rejects a wrong password', async () => {
    const resp = await requestWithSupertest
      .post('/auth/login')
      .set('tenantId', TENANT_ID)
      .send({ email: student.email, password: '123' });

    expect(resp.status).toBe(401);
    expect(resp.body.success).toBe(false);
  });

  it('200: authenticates a correct password and returns the user + cookie', async () => {
    const resp = await requestWithSupertest
      .post('/auth/login')
      .set('tenantId', TENANT_ID)
      .send({ email: student.email, password: 'somePassword' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.email).toBe(student.email);
    expect(resp.headers['set-cookie'].join(';')).toContain('x-auth');
  });
});

describe('GET /auth/logout (full stack)', () => {
  it('200: clears the auth cookie and returns success', async () => {
    const resp = await requestWithSupertest
      .get('/auth/logout')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /auth/forgot-password (full stack)', () => {
  it('200: issues a reset token + email for a known user', async () => {
    const resp = await requestWithSupertest
      .post('/auth/forgot-password')
      .set('tenantId', TENANT_ID)
      .send({ email: admin.email });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  it('400: Email not found for an unknown user', async () => {
    const resp = await requestWithSupertest
      .post('/auth/forgot-password')
      .set('tenantId', TENANT_ID)
      .send({ email: 'nonexistent@example.com' });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});

describe('POST /auth/reset-password (full stack)', () => {
  it('400: rejects an invalid reset token', async () => {
    const resp = await requestWithSupertest
      .post('/auth/reset-password')
      .set('tenantId', TENANT_ID)
      .send({
        email: admin.email,
        password: 'NewPassword1!',
        token: 'someInvalidToken123'
      });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});

describe('POST /auth/resend-activation (full stack)', () => {
  it('400: already-activated known user is rejected', async () => {
    // Seeded users are isAccountActivated: true.
    const resp = await requestWithSupertest
      .post('/auth/resend-activation')
      .set('tenantId', TENANT_ID)
      .send({ email: admin.email });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });

  it('400: unknown email is rejected', async () => {
    const resp = await requestWithSupertest
      .post('/auth/resend-activation')
      .set('tenantId', TENANT_ID)
      .send({ email: 'unknown@example.com' });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});
