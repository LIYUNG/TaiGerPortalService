import UserDAO from '../dao/user.dao';

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

  updateOfficehours(userId, role, payload) {
    return UserDAO.updateOfficehours(userId, role, payload);
  },

  updateUserDoc(userId, payload, options = { new: true }) {
    return UserDAO.updateUserDoc(userId, payload, options);
  },

  getUserByEmail(email) {
    return UserDAO.getUserByEmail(email);
  },

  getUserByFilter(filter) {
    return UserDAO.getUserByFilter(filter);
  },

  getUserDocByFilter(filter) {
    return UserDAO.getUserDocByFilter(filter);
  },

  createGuest(payload) {
    return UserDAO.createGuest(payload);
  },

  getUserByIdSelect(userId, select) {
    return UserDAO.getUserByIdSelect(userId, select);
  },

  getUserDocWithPasswordByEmail(email) {
    return UserDAO.getUserDocWithPasswordByEmail(email);
  },

  touchLastLoginByEmail(email) {
    return UserDAO.touchLastLoginByEmail(email);
  },

  touchLastLoginById(userId) {
    return UserDAO.touchLastLoginById(userId);
  },

  findAgents(filter, select) {
    return UserDAO.findAgents(filter, select);
  },

  findEditors(filter, select) {
    return UserDAO.findEditors(filter, select);
  },

  findAgentById(agentId, select) {
    return UserDAO.findAgentById(agentId, select);
  },

  getUserDocById(userId) {
    return UserDAO.getUserDocById(userId);
  },

  getAgentDocById(agentId) {
    return UserDAO.getAgentDocById(agentId);
  },

  createUser(role, payload) {
    return UserDAO.createUser(role, payload);
  },

  updateUserWithOptions(userId, fields, options) {
    return UserDAO.updateUserWithOptions(userId, fields, options);
  },

  updateUserArchiv(userId, isArchived) {
    return UserDAO.updateUserArchiv(userId, isArchived);
  },

  deleteUserById(userId) {
    return UserDAO.deleteUserById(userId);
  },

  pullStaffFromStudents(userId) {
    return UserDAO.pullStaffFromStudents(userId);
  },

  deleteStudentCascade(userId) {
    return UserDAO.deleteStudentCascade(userId);
  },

  getUserRoleCounts() {
    return UserDAO.getUserRoleCounts();
  },

  getUsersOverview() {
    return UserDAO.getUsersOverview();
  }
};

module.exports = UserService;
