// Unit tests for middlewares/passport.js
//
// The module configures two passport strategies (Local + Jwt) at require time by
// calling passport.use(new Strategy(opts, verifyFn)). None of the verify
// callbacks are exported, so we mock passport (to capture every strategy
// instance), and mock passport-local / passport-jwt to plain classes that store
// (options, verify). We then invoke the captured verify callbacks directly with
// fake args and assert the done() outcomes. UserService is mocked — no DB.

const mockStrategies: any[] = [];
jest.mock('passport', () => ({
  use: jest.fn((strategy: any) => {
    mockStrategies.push(strategy);
  })
}));
jest.mock('passport-local', () => ({
  Strategy: class LocalStrategy {
    name: string;
    options: any;
    verify: any;
    constructor(options: any, verify: any) {
      this.name = 'local';
      this.options = options;
      this.verify = verify;
    }
  }
}));
jest.mock('passport-jwt', () => ({
  Strategy: class JwtStrategy {
    name: string;
    options: any;
    verify: any;
    constructor(options: any, verify: any) {
      this.name = 'jwt';
      this.options = options;
      this.verify = verify;
    }
  }
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  JWT_SECRET: 'secret-key'
}));
// Prevent the real service -> models -> Mongoose load chain (NO DB).
jest.mock('../../models', () => ({}));
jest.mock('../../services/users');

import UserServiceReal from '../../services/users';
import '../../middlewares/passport';

const UserService = UserServiceReal as unknown as Record<string, jest.Mock>;

const localStrategy = mockStrategies.find((s) => s.name === 'local');
const jwtStrategy = mockStrategies.find((s) => s.name === 'jwt');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LocalStrategy verify', () => {
  const verify = (req: any, email: any, password: any) =>
    new Promise<any[]>((resolve) => {
      localStrategy.verify(req, email, password, (...args: any[]) =>
        resolve(args)
      );
    });

  it('uses email as the username field and passes req', () => {
    expect(localStrategy.options).toEqual({
      usernameField: 'email',
      passReqToCallback: true
    });
  });

  it('returns (null, false) when the user is not found', async () => {
    UserService.getUserDocWithPasswordByEmail.mockResolvedValue(null);
    const [err, user] = await verify({}, 'a@b.c', 'pw');
    expect(err).toBeNull();
    expect(user).toBe(false);
  });

  it('returns (null, false) when the password is invalid', async () => {
    UserService.getUserDocWithPasswordByEmail.mockResolvedValue({
      verifyPassword: jest.fn().mockResolvedValue(false),
      isAccountActivated: true
    });
    const [err, user] = await verify({}, 'a@b.c', 'wrong');
    expect(err).toBeNull();
    expect(user).toBe(false);
  });

  it('returns (null, "inactivated") when the account is not activated', async () => {
    UserService.getUserDocWithPasswordByEmail.mockResolvedValue({
      verifyPassword: jest.fn().mockResolvedValue(true),
      isAccountActivated: false
    });
    const [err, user] = await verify({}, 'a@b.c', 'pw');
    expect(err).toBeNull();
    expect(user).toBe('inactivated');
  });

  it('returns the user and touches lastLogin on success', async () => {
    const userDoc = {
      verifyPassword: jest.fn().mockResolvedValue(true),
      isAccountActivated: true
    };
    UserService.getUserDocWithPasswordByEmail.mockResolvedValue(userDoc);
    UserService.touchLastLoginByEmail.mockResolvedValue({});

    const [err, user] = await verify({}, 'a@b.c', 'pw');

    expect(err).toBeNull();
    expect(user).toBe(userDoc);
    expect(UserService.touchLastLoginByEmail).toHaveBeenCalledWith('a@b.c');
  });

  it('forwards thrown errors to done(err)', async () => {
    UserService.getUserDocWithPasswordByEmail.mockRejectedValue(
      new Error('db down')
    );
    const [err] = await verify({}, 'a@b.c', 'pw');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('db down');
  });
});

describe('JwtStrategy verify', () => {
  const verify = (req: any, payload: any) =>
    new Promise<any[]>((resolve) => {
      jwtStrategy.verify(req, payload, (...args: any[]) => resolve(args));
    });

  it('extracts the jwt from the x-auth cookie', () => {
    const token = jwtStrategy.options.jwtFromRequest({
      cookies: { 'x-auth': 'cookie-token' }
    });
    expect(token).toBe('cookie-token');
    expect(jwtStrategy.options.secretOrKey).toBe('secret-key');
  });

  it('returns (null, false) when the user is not found', async () => {
    UserService.getUserDocById.mockResolvedValue(null);
    const [err, user] = await verify({}, { id: 'u1' });
    expect(err).toBeNull();
    expect(user).toBe(false);
  });

  it('returns the user and touches lastLogin on success', async () => {
    const userDoc = { _id: 'u1' };
    UserService.getUserDocById.mockResolvedValue(userDoc);
    UserService.touchLastLoginById.mockResolvedValue({});

    const [err, user] = await verify({}, { id: 'u1' });

    expect(err).toBeNull();
    expect(user).toBe(userDoc);
    expect(UserService.touchLastLoginById).toHaveBeenCalledWith('u1');
  });

  it('forwards thrown errors to done(err)', async () => {
    UserService.getUserDocById.mockRejectedValue(new Error('boom'));
    const [err] = await verify({}, { id: 'u1' });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
  });
});
