const StudentDAO = require('../dao/student.dao');

/**
 * StudentService — business/orchestration layer for students.
 *
 * Data access lives in the DAO (dao/student.dao.js), which talks to the central
 * default-connection models. The service is the seam where student business
 * logic belongs; today most methods are thin pass-throughs to the DAO
 * (controller -> service -> dao).
 */
const StudentService = {
  fetchStudents(filter = {}, options = {}) {
    return StudentDAO.fetchStudents(filter, options);
  },

  fetchSimpleStudents(filter) {
    return StudentDAO.fetchSimpleStudents(filter);
  },

  getStudentsPaginated({ filter = {}, query = {} }) {
    return StudentDAO.getStudentsPaginated({ filter, query });
  },

  getStudents({ filter = {}, options = {} }) {
    return StudentDAO.getStudents({ filter, options });
  },

  getStudentById(id) {
    return StudentDAO.getStudentById(id);
  },

  getStudentByIdLean(id) {
    return StudentDAO.getStudentByIdLean(id);
  },

  getStudentDocById(id) {
    return StudentDAO.getStudentDocById(id);
  },

  getStudentByIdPopulated(id, populates = []) {
    return StudentDAO.getStudentByIdPopulated(id, populates);
  },

  getStudentDocByIdPopulated(id, populates = []) {
    return StudentDAO.getStudentDocByIdPopulated(id, populates);
  },

  updateStudentByFilter(filter, update) {
    return StudentDAO.updateStudentByFilter(filter, update);
  },

  updateStudentByIdRaw(id, update) {
    return StudentDAO.updateStudentByIdRaw(id, update);
  },

  findStudents(filter = {}) {
    return StudentDAO.findStudents(filter);
  },

  findStudentsWithTeamNames(filter = {}) {
    return StudentDAO.findStudentsWithTeamNames(filter);
  },

  countStudents(filter = {}) {
    return StudentDAO.countStudents(filter);
  },

  getStudentApplicationsForIntervals(studentId) {
    return StudentDAO.getStudentApplicationsForIntervals(studentId);
  },

  findStudentsSelect(filter = {}, select = '', limit = undefined) {
    return StudentDAO.findStudentsSelect(filter, select, limit);
  },

  getTaigerUsersWithExpenses() {
    return StudentDAO.getTaigerUsersWithExpenses();
  },

  getStudentsWithExpenses() {
    return StudentDAO.getStudentsWithExpenses();
  },

  getStudentsForExpenses(filter) {
    return StudentDAO.getStudentsForExpenses(filter);
  },

  getStudentByIdWithAgents(id) {
    return StudentDAO.getStudentByIdWithAgents(id);
  },

  getStudentByIdWithTeam(id) {
    return StudentDAO.getStudentByIdWithTeam(id);
  },

  getStudentByIdWithDocThreads(id) {
    return StudentDAO.getStudentByIdWithDocThreads(id);
  },

  updateStudentById(id, update) {
    return StudentDAO.updateStudentById(id, update);
  },

  getStudentsWithApplications(filter) {
    return StudentDAO.getStudentsWithApplications(filter);
  }
};

module.exports = StudentService;
