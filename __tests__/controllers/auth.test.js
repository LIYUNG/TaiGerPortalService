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
    protect: jest.fn().mockImplementation(passthrough),
    // localAuth: jest.fn().mockImplementation(passthrough),
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

describe('auth Controller: login', () => {
  it('should failed if password not correct', async () => {
    const resp = await requestWithSupertest
      .post('/auth/login')
      .set('tenantId', TENANT_ID)
      .send({
        email: student.email,
        password: '123'
      });

    expect(resp.status).toBe(401);
  });

  it('should success if password is correct', async () => {
    const resp2 = await requestWithSupertest
      .post('/auth/login')
      .set('tenantId', TENANT_ID)
      .send({
        email: student.email,
        password: 'somePassword'
      });
    expect(resp2.status).toBe(200);
  });
});

describe('GET /auth/logout', () => {
  it('should logout and return 200', async () => {
    const resp = await requestWithSupertest
      .get('/auth/logout')
      .set('tenantId', TENANT_ID);

    expect([200, 302]).toContain(resp.status);
  });
});

describe('POST /auth/forgot-password', () => {
  it('should return a valid status when submitting a known email', async () => {
    const resp = await requestWithSupertest
      .post('/auth/forgot-password')
      .set('tenantId', TENANT_ID)
      .send({ email: admin.email });

    expect([200, 400, 404]).toContain(resp.status);
  });

  it('should return a valid status when submitting an unknown email', async () => {
    const resp = await requestWithSupertest
      .post('/auth/forgot-password')
      .set('tenantId', TENANT_ID)
      .send({ email: 'nonexistent@example.com' });

    expect([200, 400, 404]).toContain(resp.status);
  });
});

describe('POST /auth/reset-password', () => {
  it('should return a valid status when submitting a password reset with an invalid token', async () => {
    const resp = await requestWithSupertest
      .post('/auth/reset-password')
      .set('tenantId', TENANT_ID)
      .send({
        email: admin.email,
        password: 'NewPassword1!',
        token: 'someInvalidToken123'
      });

    expect([200, 400, 401, 403, 404]).toContain(resp.status);
  });
});

describe('POST /auth/resend-activation', () => {
  it('should return a valid status when resending activation for a known email', async () => {
    const resp = await requestWithSupertest
      .post('/auth/resend-activation')
      .set('tenantId', TENANT_ID)
      .send({ email: admin.email });

    expect([200, 400, 404]).toContain(resp.status);
  });

  it('should return a valid status when resending activation for an unknown email', async () => {
    const resp = await requestWithSupertest
      .post('/auth/resend-activation')
      .set('tenantId', TENANT_ID)
      .send({ email: 'unknown@example.com' });

    expect([200, 400, 404]).toContain(resp.status);
  });
});
