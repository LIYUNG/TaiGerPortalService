// PermissionService methods are mostly thin pass-throughs to PermissionDAO;
// decrementTaigerAiQuota adds real conditional logic (only decrement while the
// quota is > 0, then save). This is a UNIT test: the DAO is mocked so no
// database is touched.
jest.mock('../../dao/permission.dao');

import PermissionDAOReal from '../../dao/permission.dao';
import PermissionService from '../../services/permissions';

const PermissionDAO = PermissionDAOReal as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PermissionService — PermissionDAO delegators (mocked DAO)', () => {
  it('getPermissions delegates to DAO.getPermissions with filter', async () => {
    const filter = { role: 'Manager' };
    const daoResult = [{ _id: 'p1' }];
    PermissionDAO.getPermissions.mockResolvedValue(daoResult);

    const result = await PermissionService.getPermissions(filter);

    expect(PermissionDAO.getPermissions).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.getPermissions).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getPermissions defaults filter to {} when omitted', async () => {
    const daoResult: any[] = [];
    PermissionDAO.getPermissions.mockResolvedValue(daoResult);

    const result = await PermissionService.getPermissions();

    expect(PermissionDAO.getPermissions).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.getPermissions).toHaveBeenCalledWith({});
    expect(result).toBe(daoResult);
  });

  it('findPermissionsWithUser delegates to DAO.findPermissionsWithUser with filter+select', async () => {
    const filter = { canAssignAgents: true };
    const select = 'user_id taigerAiQuota';
    const daoResult = [{ _id: 'p1' }];
    PermissionDAO.findPermissionsWithUser.mockResolvedValue(daoResult);

    const result = await PermissionService.findPermissionsWithUser(
      filter,
      select
    );

    expect(PermissionDAO.findPermissionsWithUser).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.findPermissionsWithUser).toHaveBeenCalledWith(
      filter,
      select
    );
    expect(result).toBe(daoResult);
  });

  it('findPermissionsWithUser defaults filter to {} when omitted', async () => {
    const daoResult: any[] = [];
    PermissionDAO.findPermissionsWithUser.mockResolvedValue(daoResult);

    const result = await PermissionService.findPermissionsWithUser();

    expect(PermissionDAO.findPermissionsWithUser).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.findPermissionsWithUser).toHaveBeenCalledWith(
      {},
      undefined
    );
    expect(result).toBe(daoResult);
  });

  it('upsertPermissionByUserId delegates to DAO.upsertPermissionByUserId with userId+payload', async () => {
    const payload = { canModifyDocs: true };
    const daoResult = { _id: 'p1', user_id: 'u1' };
    PermissionDAO.upsertPermissionByUserId.mockResolvedValue(daoResult);

    const result = await PermissionService.upsertPermissionByUserId(
      'u1',
      payload as any
    );

    expect(PermissionDAO.upsertPermissionByUserId).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.upsertPermissionByUserId).toHaveBeenCalledWith(
      'u1',
      payload
    );
    expect(result).toBe(daoResult);
  });

  it('getManagers delegates to DAO.getManagers', async () => {
    const daoResult = [{ _id: 'p1' }];
    PermissionDAO.getManagers.mockResolvedValue(daoResult);

    const result = await PermissionService.getManagers();

    expect(PermissionDAO.getManagers).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.getManagers).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getPermissionByUserId delegates to DAO.getPermissionByUserId with userId', async () => {
    const daoResult = { _id: 'p1', user_id: 'u1' };
    PermissionDAO.getPermissionByUserId.mockResolvedValue(daoResult);

    const result = await PermissionService.getPermissionByUserId('u1');

    expect(PermissionDAO.getPermissionByUserId).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.getPermissionByUserId).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });
});

describe('PermissionService.decrementTaigerAiQuota (mocked DAO)', () => {
  it('decrements and saves when quota > 0, returning the doc', async () => {
    const permission = {
      taigerAiQuota: 3,
      save: jest.fn().mockResolvedValue(undefined)
    };
    PermissionDAO.getPermissionDocByUserId.mockResolvedValue(permission);

    const result = await PermissionService.decrementTaigerAiQuota('u1');

    expect(PermissionDAO.getPermissionDocByUserId).toHaveBeenCalledTimes(1);
    expect(PermissionDAO.getPermissionDocByUserId).toHaveBeenCalledWith('u1');
    expect(permission.taigerAiQuota).toBe(2);
    expect(permission.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(permission);
  });

  it('does not decrement or save when quota is 0', async () => {
    const permission = {
      taigerAiQuota: 0,
      save: jest.fn().mockResolvedValue(undefined)
    };
    PermissionDAO.getPermissionDocByUserId.mockResolvedValue(permission);

    const result = await PermissionService.decrementTaigerAiQuota('u1');

    expect(permission.taigerAiQuota).toBe(0);
    expect(permission.save).not.toHaveBeenCalled();
    expect(result).toBe(permission);
  });
});
