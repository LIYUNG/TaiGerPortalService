const UserDAO = require('../dao/user.dao');

/**
 * UserService — business layer for users. Delegates data access to the DAO
 * (controller -> service -> dao). `parseUsersPaginationQuery` is a pure helper
 * exposed for controllers that build the pagination args.
 */
const UserService = {
  parseUsersPaginationQuery(query) {
    return UserDAO.parseUsersPaginationQuery(query);
  },

  getUserById(userId) {
    return UserDAO.getUserById(userId);
  },

  getUsers(query) {
    return UserDAO.getUsers(query);
  },

  getUsersPaginated(args) {
    return UserDAO.getUsersPaginated(args);
  },

  updateUser(userId, payload) {
    return UserDAO.updateUser(userId, payload);
  },

  updateUserDoc(userId, payload, options = { new: true }) {
    return UserDAO.updateUserDoc(userId, payload, options);
  },

  getUserByEmail(email) {
    return UserDAO.getUserByEmail(email);
  }
};

module.exports = UserService;
