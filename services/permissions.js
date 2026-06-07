const PermissionDAO = require('../dao/permission.dao');

/**
 * PermissionService — business layer for user permissions. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const PermissionService = {
  getPermissions(filter = {}) {
    return PermissionDAO.getPermissions(filter);
  },

  findPermissionsWithUser(filter = {}) {
    return PermissionDAO.findPermissionsWithUser(filter);
  },

  upsertPermissionByUserId(userId, payload) {
    return PermissionDAO.upsertPermissionByUserId(userId, payload);
  },

  getManagers() {
    return PermissionDAO.getManagers();
  },

  // Decrement a user's remaining TaiGer AI quota by one (only while > 0).
  // Mirrors the legacy inline logic in the taigerai controllers.
  async decrementTaigerAiQuota(userId) {
    const permission = await PermissionDAO.getPermissionDocByUserId(userId);
    if (permission.taigerAiQuota > 0) {
      permission.taigerAiQuota -= 1;
      await permission.save();
    }
    return permission;
  }
};

module.exports = PermissionService;
