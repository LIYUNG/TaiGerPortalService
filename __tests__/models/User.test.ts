// Unit tests for the plain-function pieces of models/User.js:
//   - the password-hashing pre('save') hook
//   - the password-hashing pre('findOneAndUpdate') hook
//   - the verifyPassword() and toJSON() instance methods
//
// We never touch a real database. bcrypt is mocked so the hooks/methods are
// pure functions over a fake `this`. The hooks are pulled off the compiled
// schema (UserSchema.s.hooks). Because the base schema (from
// @taiger-common/model) may register additional pre hooks, we identify "the
// password hook" by behavior: run each candidate against a fake doc and keep
// the one that actually invokes bcrypt.hash.

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('SALT'),
  hash: jest.fn().mockResolvedValue('HASHED'),
  compare: jest.fn().mockResolvedValue(true)
}));

import bcryptReal from 'bcryptjs';
import { UserSchema } from '../../models/User';

const bcrypt = bcryptReal as unknown as Record<string, jest.Mock>;

const preHooks = (event: string) => {
  const map = (UserSchema as any).s.hooks._pres;
  const list = map.get(event) || [];
  return list.map((h: any) => h.fn);
};

// Runs a single pre-hook (which takes a `next` callback) and resolves once
// next() fires, returning the error next() was called with (if any).
const runHook = (fn: any, ctx: any): Promise<any> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const next = (err: any) => {
      if (settled) return;
      settled = true;
      resolve(err);
    };
    try {
      const maybe = fn.call(ctx, next);
      // Some hooks return a promise that rejects instead of calling next(err).
      if (maybe && typeof maybe.then === 'function') {
        maybe.catch((e: any) => {
          if (!settled) {
            settled = true;
            reject(e);
          }
        });
      }
    } catch (e) {
      reject(e);
    }
  });

beforeEach(() => {
  jest.clearAllMocks();
  bcrypt.genSalt.mockResolvedValue('SALT');
  bcrypt.hash.mockResolvedValue('HASHED');
  bcrypt.compare.mockResolvedValue(true);
});

describe('pre(save) password hashing', () => {
  // Find the hook that hashes the password when the field is modified.
  const findSaveHashHook = async () => {
    const hooks = preHooks('save');
    for (const fn of hooks) {
      bcrypt.hash.mockClear();
      const ctx = {
        password: 'plain',
        isModified: jest.fn().mockReturnValue(true)
      };
      // eslint-disable-next-line no-await-in-loop
      await runHook(fn, ctx).catch(() => {});
      if (bcrypt.hash.mock.calls.length > 0) {
        return fn;
      }
    }
    return null;
  };

  test('a save hook hashes the password when it was modified', async () => {
    const fn = await findSaveHashHook();
    expect(fn).not.toBeNull();

    bcrypt.genSalt.mockClear();
    bcrypt.hash.mockClear();
    const ctx = {
      password: 'plaintext',
      isModified: jest.fn().mockReturnValue(true)
    };
    const err = await runHook(fn, ctx);
    expect(err).toBeUndefined();
    expect(ctx.isModified).toHaveBeenCalledWith('password');
    expect(bcrypt.genSalt).toHaveBeenCalledWith(10);
    expect(bcrypt.hash).toHaveBeenCalledWith('plaintext', 'SALT');
    expect(ctx.password).toBe('HASHED');
  });

  test('the hook skips hashing when the password is unchanged', async () => {
    const fn = await findSaveHashHook();
    bcrypt.hash.mockClear();
    const ctx = {
      password: 'untouched',
      isModified: jest.fn().mockReturnValue(false)
    };
    const err = await runHook(fn, ctx);
    expect(err).toBeUndefined();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(ctx.password).toBe('untouched');
  });

  test('the hook forwards a bcrypt error to next()', async () => {
    const fn = await findSaveHashHook();
    bcrypt.genSalt.mockRejectedValueOnce(new Error('salt failed'));
    const ctx = {
      password: 'plaintext',
      isModified: jest.fn().mockReturnValue(true)
    };
    const err = await runHook(fn, ctx);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('salt failed');
  });
});

describe('pre(findOneAndUpdate) password hashing', () => {
  const findUpdateHashHook = async () => {
    const hooks = preHooks('findOneAndUpdate');
    for (const fn of hooks) {
      bcrypt.hash.mockClear();
      const ctx = { getUpdate: () => ({ password: 'p' }) };
      // eslint-disable-next-line no-await-in-loop
      await runHook(fn, ctx).catch(() => {});
      if (bcrypt.hash.mock.calls.length > 0) {
        return fn;
      }
    }
    return null;
  };

  test('hashes a top-level password in the update', async () => {
    const fn = await findUpdateHashHook();
    expect(fn).not.toBeNull();

    bcrypt.hash.mockClear();
    const update = { password: 'newpass' };
    const ctx = { getUpdate: () => update };
    const err = await runHook(fn, ctx);
    expect(err).toBeUndefined();
    expect(bcrypt.hash).toHaveBeenCalledWith('newpass', 'SALT');
    expect(update.password).toBe('HASHED');
  });

  test('hashes a $set.password in the update', async () => {
    const fn = await findUpdateHashHook();
    bcrypt.hash.mockClear();
    const update = { $set: { password: 'newpass' } };
    const ctx = { getUpdate: () => update };
    const err = await runHook(fn, ctx);
    expect(err).toBeUndefined();
    expect(bcrypt.hash).toHaveBeenCalledWith('newpass', 'SALT');
    expect(update.$set.password).toBe('HASHED');
  });

  test('does nothing when the update has no password', async () => {
    const fn = await findUpdateHashHook();
    bcrypt.hash.mockClear();
    const update = { firstname: 'No' };
    const ctx = { getUpdate: () => update };
    const err = await runHook(fn, ctx);
    expect(err).toBeUndefined();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  test('forwards a bcrypt error to next()', async () => {
    const fn = await findUpdateHashHook();
    bcrypt.genSalt.mockRejectedValueOnce(new Error('hash failed'));
    const ctx = { getUpdate: () => ({ password: 'newpass' }) };
    const err = await runHook(fn, ctx);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('hash failed');
  });
});

describe('instance methods', () => {
  test('verifyPassword delegates to bcrypt.compare with the stored hash', async () => {
    const ctx = { password: 'STORED_HASH' };
    const result = await UserSchema.methods.verifyPassword.call(ctx, 'guess');
    expect(bcrypt.compare).toHaveBeenCalledWith('guess', 'STORED_HASH');
    expect(result).toBe(true);
  });

  test('verifyPassword returns false when bcrypt reports a mismatch', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    const ctx = { password: 'STORED_HASH' };
    const result = await UserSchema.methods.verifyPassword.call(ctx, 'wrong');
    expect(result).toBe(false);
  });

  test('toJSON strips password and __v from the plain object', () => {
    const plain = {
      _id: 'abc',
      firstname: 'A',
      password: 'secret',
      __v: 3
    };
    const ctx = { toObject: () => ({ ...plain }) };
    const json = UserSchema.methods.toJSON.call(ctx);
    expect(json).toEqual({ _id: 'abc', firstname: 'A' });
    expect(json).not.toHaveProperty('password');
    expect(json).not.toHaveProperty('__v');
  });
});
