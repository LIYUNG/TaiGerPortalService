import passport from 'passport';

import { localAuth, protect, permit, prohibit } from '../../middlewares/auth';
import { ErrorResponse } from '../../common/errors';

jest.mock('passport');

describe('auth middleware', () => {
  let req: any, res: any, next: any;

  beforeEach(() => {
    req = { user: {} };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to make passport.authenticate invoke its callback with given (err, user)
  const mockAuthenticate = (err: any, user: any) => {
    (passport.authenticate as jest.Mock).mockImplementation(
      (strategy: any, opts: any, callback: any) =>
        (rq: any, rs: any, nx: any) =>
          callback(err, user)
    );
  };

  describe('localAuth', () => {
    it('passes error to next when passport errors', () => {
      const err = new Error('boom');
      mockAuthenticate(err, null);
      localAuth(req, res, next);
      expect(next).toHaveBeenCalledWith(err);
    });

    it('returns 403 when account is inactivated', () => {
      mockAuthenticate(null, 'inactivated');
      localAuth(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
    });

    it('returns 401 when no user (wrong password)', () => {
      mockAuthenticate(null, null);
      localAuth(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    it('sets req.user and calls next on success', () => {
      const user = { _id: 'u1', role: 'Student' };
      mockAuthenticate(null, user);
      localAuth(req, res, next);
      expect(req.user).toBe(user);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('protect', () => {
    it('passes error to next when passport errors', () => {
      const err = new Error('jwt boom');
      mockAuthenticate(err, null);
      protect(req, res, next);
      expect(next).toHaveBeenCalledWith(err);
    });

    it('returns 401 when no user (session expired)', () => {
      mockAuthenticate(null, null);
      protect(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    it('sets req.user and calls next on success', () => {
      const user = { _id: 'u2', role: 'Admin' };
      mockAuthenticate(null, user);
      protect(req, res, next);
      expect(req.user).toBe(user);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('permit', () => {
    it('calls next() when user role is in the allowed list', () => {
      req.user = { role: 'Admin' };
      permit('Admin', 'Agent')(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('errors 403 when user role is not allowed', () => {
      req.user = { role: 'Student' };
      permit('Admin', 'Agent')(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  describe('prohibit', () => {
    it('errors 403 when user role is in the prohibited list', () => {
      req.user = { role: 'Guest' };
      prohibit('Guest', 'Student')(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
    });

    it('calls next() when user role is not prohibited', () => {
      req.user = { role: 'Admin' };
      prohibit('Guest', 'Student')(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
