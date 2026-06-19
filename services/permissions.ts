import { FilterQuery } from 'mongoose';
import { IPermission } from '@taiger-common/model';
import PermissionDAO from '../dao/permission.dao';

/**
 * PermissionService — business layer for user permissions. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const PermissionService = {
  getPermissions(filter: FilterQuery<IPermission> = {}) {
    return PermissionDAO.getPermissions(filter);
  },

  findPermissionsWithUser(
    filter: FilterQuery<IPermission> = {},
    select?: string
  ) {
    return PermissionDAO.findPermissionsWithUser(filter, select);
  },

  upsertPermissionByUserId(userId: string, payload: Partial<IPermission>) {
    return PermissionDAO.upsertPermissionByUserId(userId, payload);
  },

  getManagers() {
    return PermissionDAO.getManagers();
  },

  getPermissionByUserId(userId: string) {
    return PermissionDAO.getPermissionByUserId(userId);
  },

  // Decrement a user's remaining TaiGer AI quota by one (only while > 0).
  // Mirrors the legacy inline logic in the taigerai controllers.
  async decrementTaigerAiQuota(userId: string) {
    const permission = await PermissionDAO.getPermissionDocByUserId(userId);
    if (permission.taigerAiQuota > 0) {
      permission.taigerAiQuota -= 1;
      await permission.save();
    }
    return permission;
  }
};

export = PermissionService;
