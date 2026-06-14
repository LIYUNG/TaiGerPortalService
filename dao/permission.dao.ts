const { Permission } = require('../models');

/**
 * PermissionDAO — data access for the Permission model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const PermissionDAO = {
  async getPermissions(filter = {}) {
    return Permission.find(filter).lean();
  },

  // Permissions matching `filter` with the user populated — used to resolve
  // agent/editor leads. `select` controls the populated user fields.
  async findPermissionsWithUser(
    filter = {},
    select = 'firstname lastname email'
  ) {
    return Permission.find(filter).populate('user_id', select).lean();
  },

  async upsertPermissionByUserId(userId, payload) {
    return Permission.findOneAndUpdate({ user_id: userId }, payload, {
      upsert: true,
      new: true
    })
      .populate('user_id', 'firstname lastname email')
      .lean();
  },

  // Live (non-lean) document so callers can mutate + .save() it.
  async getPermissionDocByUserId(userId) {
    return Permission.findOne({ user_id: userId });
  },

  async getPermissionByUserId(userId) {
    return Permission.findOne({ user_id: userId }).lean();
  },

  // Managers = users with any of the elevated capability flags. Used to notify
  // the right people about customer-center tickets.
  async getManagers() {
    return Permission.find({
      $or: [
        { canAssignEditors: true },
        { canAssignAgents: true },
        { canModifyAllBaseDocuments: true },
        { canAccessAllChat: true }
      ]
    })
      .populate('user_id', 'firstname lastname email archiv pictureUrl')
      .lean();
  }
};

module.exports = PermissionDAO;
