// Controller UNIT test for controllers/auth.
//
// auth is the "special" controller: login/logout/verify are synchronous and
// lean on req.user / req.tenantId + a signed JWT cookie; the rest
// (activate/resend/forgot/reset/thirdAuth) are asyncHandler-wrapped and fan out
// to UserService + TokenService + the email module (+ axios/Google for OAuth).
// We call each handler DIRECTLY as a (req, res, next) function with all of those
// collaborators mocked, and assert ONLY the controller's own work:
//   - the status + body / cookie it writes,
//   - the args it forwards to the service,
//   - that an ErrorResponse / service error is forwarded to next().
// The express-validator field checks run for real, so handlers that validate are
// given valid bodies. Route + passport wiring + real persistence is covered by
// __tests__/integration/auth.test.js.

jest.mock('../../services/users');
jest.mock('../../services/tokens');
jest.mock('../../services/email', () => ({
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendForgotPasswordEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountActivationConfirmationEmail: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('axios');
jest.mock('../../utils/helper', () => ({
  ...jest.requireActual('../../utils/helper'),
  fetchUserFromIdToken: jest.fn()
}));

import axios from 'axios';
import UserService from '../../services/users';
import TokenService from '../../services/tokens';
import * as EmailService from '../../services/email';
import { fetchUserFromIdToken } from '../../utils/helper';
import {
  signup,
  login,
  logout,
  verify,
  activateAccount,
  resendActivation,
  forgotPassword,
  resetPassword,
  thirdAuth
} from '../../controllers/auth';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin } from '../mock/user';

const fakeUser = {
  _id: admin._id,
  firstname: 'Ann',
  lastname: 'Smith',
  email: 'ann@example.com',
  role: 'Admin',
  isAccountActivated: true
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('login', () => {
  it('signs a JWT into the x-auth cookie and responds 200 with req.user', () => {
    const res = mockRes();

    login(mockReq({ user: fakeUser, tenantId: 'test' }), res);

    expect(res.cookie).toHaveBeenCalledWith(
      'x-auth',
      expect.any(String),
      expect.objectContaining({ httpOnly: true })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeUser });
  });
});

describe('logout', () => {
  it('clears the x-auth cookie and responds 200', () => {
    const res = mockRes();

    logout(mockReq(), res);

    expect(res.clearCookie).toHaveBeenCalledWith('x-auth', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('verify', () => {
  it('responds 200 with the protected user from req.user', () => {
    const res = mockRes();

    verify(mockReq({ user: { ...fakeUser }, tenantId: 'test' }), res);

    expect(res.cookie).toHaveBeenCalledWith(
      'x-auth',
      expect.any(String),
      expect.any(Object)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(fakeUser.email);
  });
});

describe('signup', () => {
  const validBody = {
    firstname: 'Ann',
    lastname: 'Smith',
    email: 'ann@example.com',
    password: 'NewPassword1!'
  };

  it('creates a guest, stores a hashed activation token, emails them, responds 201', async () => {
    UserService.getUserByEmail.mockResolvedValue(null);
    UserService.createGuest.mockResolvedValue({ _id: fakeUser._id });
    TokenService.createToken.mockResolvedValue({ _id: 'tok-1' });
    const res = mockRes();

    await signup(mockReq({ body: { ...validBody } }), res, jest.fn());

    expect(UserService.getUserByEmail).toHaveBeenCalledWith(validBody.email);
    expect(UserService.createGuest).toHaveBeenCalledWith(
      expect.objectContaining({ email: validBody.email })
    );
    expect(TokenService.createToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: fakeUser._id })
    );
    expect(EmailService.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 400 ErrorResponse when the email already exists (no guest created)', async () => {
    UserService.getUserByEmail.mockResolvedValue(fakeUser);
    const next = jest.fn();

    await signup(mockReq({ body: { ...validBody } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(UserService.createGuest).not.toHaveBeenCalled();
  });

  it('forwards a validation error to next() for an invalid body', async () => {
    const next = jest.fn();

    await signup(
      mockReq({
        body: { firstname: '', lastname: '', email: 'x', password: '' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(UserService.createGuest).not.toHaveBeenCalled();
  });
});

describe('forgotPassword', () => {
  it('creates a reset token and emails a known user, responds 200', async () => {
    UserService.getUserByEmail.mockResolvedValue(fakeUser);
    TokenService.createToken.mockResolvedValue({ _id: 'tok1' });
    const res = mockRes();

    await forgotPassword(
      mockReq({ body: { email: fakeUser.email } }),
      res,
      jest.fn()
    );

    expect(UserService.getUserByEmail).toHaveBeenCalledWith(fakeUser.email);
    expect(TokenService.createToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: fakeUser._id })
    );
    expect(EmailService.sendForgotPasswordEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 400 ErrorResponse to next() for an unknown user', async () => {
    UserService.getUserByEmail.mockResolvedValue(null);
    const next = jest.fn();

    await forgotPassword(
      mockReq({ body: { email: 'nobody@example.com' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(TokenService.createToken).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  it('forwards a 400 ErrorResponse to next() for an invalid/expired token', async () => {
    TokenService.findTokenByValue.mockResolvedValue(null);
    const next = jest.fn();

    await resetPassword(
      mockReq({
        body: {
          email: fakeUser.email,
          password: 'NewPassword1!',
          token: 'someInvalidToken123'
        }
      }),
      mockRes(),
      next
    );

    expect(TokenService.findTokenByValue).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it('forwards a 403 ErrorResponse to next() when the token does not match the email', async () => {
    TokenService.findTokenByValue.mockResolvedValue({ userId: fakeUser._id });
    UserService.getUserDocByFilter.mockResolvedValue(null);
    const next = jest.fn();

    await resetPassword(
      mockReq({
        body: {
          email: fakeUser.email,
          password: 'NewPassword1!',
          token: 'sometoken123456'
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('saves the new password and responds 200 on a valid token', async () => {
    const userDoc = {
      _id: fakeUser._id,
      firstname: 'Ann',
      lastname: 'Smith',
      email: fakeUser.email,
      password: 'old',
      save: jest.fn().mockResolvedValue(undefined)
    };
    TokenService.findTokenByValue.mockResolvedValue({
      id: 'tok1',
      userId: fakeUser._id
    });
    UserService.getUserDocByFilter.mockResolvedValue(userDoc);
    const res = mockRes();

    await resetPassword(
      mockReq({
        body: {
          email: fakeUser.email,
          password: 'NewPassword1!',
          token: 'sometoken123456'
        }
      }),
      res,
      jest.fn()
    );

    expect(userDoc.password).toBe('NewPassword1!');
    expect(userDoc.save).toHaveBeenCalled();
    expect(EmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('resendActivation', () => {
  it('forwards a 400 ErrorResponse to next() for an unknown user', async () => {
    UserService.getUserByEmail.mockResolvedValue(null);
    const next = jest.fn();

    await resendActivation(
      mockReq({ body: { email: 'unknown@example.com' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it('forwards a 400 ErrorResponse to next() for an already-activated account', async () => {
    UserService.getUserByEmail.mockResolvedValue({
      ...fakeUser,
      isAccountActivated: true
    });
    const next = jest.fn();

    await resendActivation(
      mockReq({ body: { email: fakeUser.email } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(TokenService.createToken).not.toHaveBeenCalled();
  });

  it('creates a token + emails a known, not-yet-activated user, responds 200', async () => {
    UserService.getUserByEmail.mockResolvedValue({
      ...fakeUser,
      isAccountActivated: false
    });
    TokenService.createToken.mockResolvedValue({ _id: 'tok2' });
    const res = mockRes();

    await resendActivation(
      mockReq({ body: { email: fakeUser.email } }),
      res,
      jest.fn()
    );

    expect(TokenService.createToken).toHaveBeenCalledTimes(1);
    expect(EmailService.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('activateAccount', () => {
  it('forwards a 400 ErrorResponse to next() for an invalid/expired token', async () => {
    TokenService.findTokenByValue.mockResolvedValue(null);
    const next = jest.fn();

    await activateAccount(
      mockReq({ body: { email: fakeUser.email, token: 'badtoken123' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it('forwards a 400 ErrorResponse when no user matches the token + email', async () => {
    TokenService.findTokenByValue.mockResolvedValue({ userId: fakeUser._id });
    UserService.getUserByFilter.mockResolvedValue(null);
    const next = jest.fn();

    await activateAccount(
      mockReq({ body: { email: fakeUser.email, token: 'validtoken123' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(UserService.updateUser).not.toHaveBeenCalled();
  });

  it('forwards a 400 ErrorResponse when the account is already activated', async () => {
    TokenService.findTokenByValue.mockResolvedValue({ userId: fakeUser._id });
    UserService.getUserByFilter.mockResolvedValue({
      ...fakeUser,
      isAccountActivated: true
    });
    const next = jest.fn();

    await activateAccount(
      mockReq({ body: { email: fakeUser.email, token: 'validtoken123' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(UserService.updateUser).not.toHaveBeenCalled();
  });

  it('activates the account and responds 200 on a valid token', async () => {
    const token = {
      id: 'tok1',
      userId: fakeUser._id
    };
    TokenService.findTokenByValue.mockResolvedValue(token);
    UserService.getUserByFilter.mockResolvedValue({
      ...fakeUser,
      isAccountActivated: false
    });
    UserService.updateUser.mockResolvedValue({
      firstname: 'Ann',
      lastname: 'Smith',
      email: fakeUser.email
    });
    const res = mockRes();

    await activateAccount(
      mockReq({
        body: { email: fakeUser.email, token: 'validtoken123' },
        tenantId: 'test'
      }),
      res,
      jest.fn()
    );

    expect(UserService.updateUser).toHaveBeenCalledWith(
      fakeUser._id,
      expect.objectContaining({ isAccountActivated: true })
    );
    expect(TokenService.deleteTokenById).toHaveBeenCalledWith('tok1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('thirdAuth (Google OAuth)', () => {
  it('exchanges the code, signs a cookie and responds 200 with the user', async () => {
    axios.post.mockResolvedValue({ data: { id_token: 'google-id-token' } });
    fetchUserFromIdToken.mockResolvedValue({
      email: fakeUser.email,
      name: 'Ann Smith',
      picture: 'http://pic'
    });
    UserService.getUserByEmail.mockResolvedValue({
      ...fakeUser,
      _id: { toString: () => fakeUser._id.toString() }
    });
    UserService.updateUser.mockResolvedValue(undefined);
    const res = mockRes();

    await thirdAuth(
      mockReq({ body: { code: 'auth-code' }, tenantId: 'test' }),
      res,
      jest.fn()
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'x-auth',
      expect.any(String),
      expect.any(Object)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(fakeUser.email);
  });

  it('forwards a 400 ErrorResponse to next() when no local user matches the Google email', async () => {
    axios.post.mockResolvedValue({ data: { id_token: 'google-id-token' } });
    fetchUserFromIdToken.mockResolvedValue({
      email: 'ghost@example.com',
      name: 'Ghost',
      picture: 'http://pic'
    });
    UserService.getUserByEmail.mockResolvedValue(null);
    const next = jest.fn();

    await thirdAuth(
      mockReq({ body: { code: 'auth-code' }, tenantId: 'test' }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(UserService.updateUser).not.toHaveBeenCalled();
  });

  it('forwards a 400 ErrorResponse to next() when the Google token is invalid', async () => {
    axios.post.mockResolvedValue({ data: { id_token: 'bad' } });
    fetchUserFromIdToken.mockResolvedValue(null);
    const next = jest.fn();

    await thirdAuth(
      mockReq({ body: { code: 'auth-code' }, tenantId: 'test' }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});
