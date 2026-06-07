const UserlogDAO = require('../dao/userlog.dao');

/**
 * UserlogService — business layer for user logs. Delegates data access to the
 * DAO (controller -> service -> dao).
 */
const UserlogService = {
  getUserlogs() {
    return UserlogDAO.getUserlogs();
  },

  getUserlogsByUserId(userId) {
    return UserlogDAO.getUserlogsByUserId(userId);
  }
};

module.exports = UserlogService;
