const InterviewDAO = require('../dao/interview.dao');

/**
 * InterviewService — business layer; delegates data access to the DAO.
 */
const InterviewService = {
  getInterviews(filter) {
    return InterviewDAO.getInterviews(filter);
  },

  getInterviewById(id) {
    return InterviewDAO.getInterviewById(id);
  },

  getInterviewsByStudentId(studentId) {
    return InterviewDAO.getInterviewsByStudentId(studentId);
  }
};

module.exports = InterviewService;
