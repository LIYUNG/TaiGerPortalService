// PermissionDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose models, so we mock the models entirely (NO database, in-memory or
// otherwise). These assert that each DAO method builds the expected
// query/options and forwards the model's result. Real query behaviour is
// covered by the integration suite (__tests__/integration), which runs against
// in-memory MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    Permission: model()
  };
});

import { Permission as PermissionModel } from '../../models';
import PermissionDAO from '../../dao/permission.dao';

// The model is auto-mocked above (every method is a jest.fn()); retype it so
// the mock API (mockReturnValue/…) is visible to the type-checker.
const Permission = PermissionModel as unknown as Record<string, jest.Mock>;

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (populate) return the same chain so they compose.
const leanChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PermissionDAO (mocked models)', () => {
  it('getPermissions forwards the filter to find().lean()', async () => {
    const docs = [{ _id: 'p1' }];
    Permission.find.mockReturnValue(leanChain(docs));

    const result = await PermissionDAO.getPermissions({ user_id: 'u1' });

    expect(Permission.find).toHaveBeenCalledWith({ user_id: 'u1' });
    expect(result).toBe(docs);
  });

  it('findPermissionsWithUser populates user_id with the default select', async () => {
    const docs = [{ _id: 'p1' }];
    const chain = leanChain(docs);
    Permission.find.mockReturnValue(chain);

    const result = await PermissionDAO.findPermissionsWithUser({ a: 1 });

    expect(Permission.find).toHaveBeenCalledWith({ a: 1 });
    expect(chain.populate).toHaveBeenCalledWith(
      'user_id',
      'firstname lastname email'
    );
    expect(result).toBe(docs);
  });

  it('findPermissionsWithUser honours a custom select', async () => {
    const chain = leanChain([]);
    Permission.find.mockReturnValue(chain);

    await PermissionDAO.findPermissionsWithUser({ a: 1 }, 'firstname');

    expect(chain.populate).toHaveBeenCalledWith('user_id', 'firstname');
  });

  it('upsertPermissionByUserId upserts, populates the user and returns the doc', async () => {
    const updated = { _id: 'p1', canAccessStudentDatabase: true };
    const chain = leanChain(updated);
    Permission.findOneAndUpdate.mockReturnValue(chain);

    const result = await PermissionDAO.upsertPermissionByUserId('u1', {
      canAccessStudentDatabase: true
    });

    expect(Permission.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: 'u1' },
      { canAccessStudentDatabase: true },
      { upsert: true, new: true }
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'user_id',
      'firstname lastname email'
    );
    expect(result).toBe(updated);
  });

  it('getPermissionDocByUserId returns the live (non-lean) doc', async () => {
    const doc = { _id: 'p1' };
    Permission.findOne.mockResolvedValue(doc);

    const result = await PermissionDAO.getPermissionDocByUserId('u1');

    expect(Permission.findOne).toHaveBeenCalledWith({ user_id: 'u1' });
    expect(result).toBe(doc);
  });

  it('getPermissionByUserId returns the lean doc', async () => {
    const doc = { _id: 'p1' };
    Permission.findOne.mockReturnValue(leanChain(doc));

    const result = await PermissionDAO.getPermissionByUserId('u1');

    expect(Permission.findOne).toHaveBeenCalledWith({ user_id: 'u1' });
    expect(result).toBe(doc);
  });

  it('getManagers queries the elevated capability flags and populates the user', async () => {
    const docs = [{ _id: 'p1' }];
    const chain = leanChain(docs);
    Permission.find.mockReturnValue(chain);

    const result = await PermissionDAO.getManagers();

    const usedFilter = Permission.find.mock.calls[0][0];
    expect(usedFilter).toHaveProperty('$or');
    expect(usedFilter.$or).toEqual(
      expect.arrayContaining([
        { canAssignEditors: true },
        { canAssignAgents: true },
        { canModifyAllBaseDocuments: true },
        { canAccessAllChat: true }
      ])
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'user_id',
      'firstname lastname email archiv pictureUrl'
    );
    expect(result).toBe(docs);
  });
});
