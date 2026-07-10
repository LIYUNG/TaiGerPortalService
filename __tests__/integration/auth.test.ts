// Integration test for the auth routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real localAuth/passport (jwt+local strategies)
//   -> real controllers/auth -> real UserService/TokenService -> MOCKED
//   UserDAO / TokenDAO.
//
// The passport authentication and the service layers run for real; only the
// email module, the tenant/cookie middleware and the DAOs are stubbed. The
// password compare runs against a mocked user document exposing verifyPassword,
// and token lookups are driven by the mocked TokenDAO. Fully deterministic — no
// database engine, no seeding.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { student, admin } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

const requestWithSupertest = request(app);

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
// protect is stubbed (the verify route is not under test here); localAuth is
// kept REAL (via the helper's jest.requireActual spread) so the login
// password compare runs against the mocked user.
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);

jest.mock('../../services/email', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendForgotPasswordEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountActivationConfirmationEmail: jest.fn().mockResolvedValue(undefined)
}));

// The data boundary: mock the DAOs the user/token services delegate to. The
// passport local strategy fetches the user (with password) through UserDAO.
jest.mock('../../dao/user.dao');
jest.mock('../../dao/token.dao');

import UserDAOModule from '../../dao/user.dao';
import TokenDAOModule from '../../dao/token.dao';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const UserDAO = UserDAOModule as unknown as MockedDAO;
const TokenDAO = TokenDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = student;
      next();
    }
  );
});

describe('POST /auth/login', () => {
  it('401: rejects a wrong password', async () => {
    UserDAO.getUserDocWithPasswordByEmail.mockResolvedValue({
      ...student,
      verifyPassword: jest.fn().mockResolvedValue(false)
    });

    const resp = await requestWithSupertest
      .post('/auth/login')
      .set('tenantId', TENANT_ID)
      .send({ email: student.email, password: '123' });

    expect(resp.status).toBe(401);
    expect(resp.body.success).toBe(false);
    expect(UserDAO.getUserDocWithPasswordByEmail).toHaveBeenCalledWith(
      student.email
    );
  });

  it('200: authenticates a correct password and returns the user + cookie', async () => {
    UserDAO.getUserDocWithPasswordByEmail.mockResolvedValue({
      _id: student._id,
      email: student.email,
      firstname: student.firstname,
      lastname: student.lastname,
      isAccountActivated: true,
      verifyPassword: jest.fn().mockResolvedValue(true)
    });
    UserDAO.touchLastLoginByEmail.mockResolvedValue(undefined);

    const resp = await requestWithSupertest
      .post('/auth/login')
      .set('tenantId', TENANT_ID)
      .send({ email: student.email, password: 'somePassword' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.email).toBe(student.email);
    // superagent's Response['headers'] type declares string values, but node
    // normalizes repeated Set-Cookie headers into a real array at runtime.
    const setCookie = resp.headers['set-cookie'] as unknown as string[];
    expect(setCookie.join(';')).toContain('x-auth');
    expect(UserDAO.touchLastLoginByEmail).toHaveBeenCalledWith(student.email);
  });
});

describe('GET /auth/logout', () => {
  it('200: clears the auth cookie and returns success', async () => {
    const resp = await requestWithSupertest
      .get('/auth/logout')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /auth/forgot-password', () => {
  it('200: issues a reset token + email for a known user', async () => {
    UserDAO.getUserByEmail.mockResolvedValue({
      _id: admin._id,
      email: admin.email,
      firstname: admin.firstname,
      lastname: admin.lastname
    });
    TokenDAO.createToken.mockResolvedValue({ _id: 'token-id' });

    const resp = await requestWithSupertest
      .post('/auth/forgot-password')
      .set('tenantId', TENANT_ID)
      .send({ email: admin.email });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(UserDAO.getUserByEmail).toHaveBeenCalledWith(admin.email);
    expect(TokenDAO.createToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: admin._id })
    );
  });

  it('400: Email not found for an unknown user', async () => {
    UserDAO.getUserByEmail.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .post('/auth/forgot-password')
      .set('tenantId', TENANT_ID)
      .send({ email: 'nonexistent@example.com' });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
    expect(TokenDAO.createToken).not.toHaveBeenCalled();
  });
});

describe('POST /auth/reset-password', () => {
  it('400: rejects an invalid reset token', async () => {
    TokenDAO.findTokenByValue.mockResolvedValue(null);

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
    expect(TokenDAO.findTokenByValue).toHaveBeenCalled();
  });
});

describe('POST /auth/resend-activation', () => {
  it('400: already-activated known user is rejected', async () => {
    UserDAO.getUserByEmail.mockResolvedValue({
      _id: admin._id,
      email: admin.email,
      isAccountActivated: true
    });

    const resp = await requestWithSupertest
      .post('/auth/resend-activation')
      .set('tenantId', TENANT_ID)
      .send({ email: admin.email });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });

  it('400: unknown email is rejected', async () => {
    UserDAO.getUserByEmail.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .post('/auth/resend-activation')
      .set('tenantId', TENANT_ID)
      .send({ email: 'unknown@example.com' });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});
