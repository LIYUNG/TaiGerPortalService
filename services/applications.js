const ApplicationDAO = require('../dao/application.dao');

/**
 * ApplicationService — business/orchestration layer for applications.
 * Data access lives in dao/application.dao.js (central default-connection
 * models). Controller -> service -> dao.
 */
const ApplicationService = {
  createApplication(studentId, programId) {
    return ApplicationDAO.createApplication(studentId, programId);
  },

  getActiveStudentsApplicationsPaginated({ studentIds = [], query = {} }) {
    return ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query
    });
  },

  getActiveStudentsApplicationsDeadlineDistribution({ studentIds = [] }) {
    return ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution({
      studentIds
    });
  },

  getApplicationProgramsUpdateStatus({ studentIds = [], decided }) {
    return ApplicationDAO.getApplicationProgramsUpdateStatus({
      studentIds,
      decided
    });
  },

  getApplicationStatusStats({ studentIds = [] }) {
    return ApplicationDAO.getApplicationStatusStats({ studentIds });
  },

  // Returns a Mongoose query (callers may chain .select()/.lean()).
  getApplications(filter = {}, select = [], populate = true) {
    return ApplicationDAO.getApplications(filter, select, populate);
  },

  getApplicationsWithStudentDetails(filter) {
    return ApplicationDAO.getApplicationsWithStudentDetails(filter);
  },

  getApplicationsByStudentId(studentId) {
    return ApplicationDAO.getApplicationsByStudentId(studentId);
  },

  getApplicationsWithCredentialsByStudentId(studentId) {
    return ApplicationDAO.getApplicationsWithCredentialsByStudentId(studentId);
  },

  getApplicationsByProgramId(programId) {
    return ApplicationDAO.getApplicationsByProgramId(programId);
  },

  getApplicationById(applicationId) {
    return ApplicationDAO.getApplicationById(applicationId);
  },

  updateApplication(filter, payload) {
    return ApplicationDAO.updateApplication(filter, payload);
  },

  deleteApplication(application_id) {
    return ApplicationDAO.deleteApplication(application_id);
  },

  updateApplicationsBulk(updates) {
    return ApplicationDAO.updateApplicationsBulk(updates);
  },

  getApplicationConflicts() {
    return ApplicationDAO.getApplicationConflicts();
  }
};

module.exports = ApplicationService;
