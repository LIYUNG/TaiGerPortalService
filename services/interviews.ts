const InterviewDAO = require('../dao/interview.dao');
const InterviewSurveyResponseDAO = require('../dao/interviewSurveyResponse.dao');

/**
 * InterviewService — business layer; delegates data access to the Interview and
 * InterviewSurveyResponse DAOs (controller -> service -> dao).
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
  },

  findByIdRaw(id) {
    return InterviewDAO.findByIdRaw(id);
  },

  findInterviews(filter, populates) {
    return InterviewDAO.findInterviews(filter, populates);
  },

  findInterviewByIdPopulated(id, populates) {
    return InterviewDAO.findInterviewByIdPopulated(id, populates);
  },

  findOneInterview(filter, populates) {
    return InterviewDAO.findOneInterview(filter, populates);
  },

  distinctTrainedStudentIds(studentIds) {
    return InterviewDAO.distinctTrainedStudentIds(studentIds);
  },

  updateInterviewByIdRaw(id, payload) {
    return InterviewDAO.updateInterviewByIdRaw(id, payload);
  },

  updateInterviewByIdPopulated(id, payload, populates) {
    return InterviewDAO.updateInterviewByIdPopulated(id, payload, populates);
  },

  upsertInterviewPopulated(filter, payload, populates) {
    return InterviewDAO.upsertInterviewPopulated(filter, payload, populates);
  },

  deleteInterviewById(id) {
    return InterviewDAO.deleteInterviewById(id);
  },

  aggregateInterviews(pipeline) {
    return InterviewDAO.aggregateInterviews(pipeline);
  },

  getInterviewsPaginated(args) {
    return InterviewDAO.getInterviewsPaginated(args);
  },

  studentInterviewProgramIds(studentId) {
    return InterviewDAO.studentInterviewProgramIds(studentId);
  },

  // ── InterviewSurveyResponse ────────────────────────────────────────────────
  findSurveys(filter, populates) {
    return InterviewSurveyResponseDAO.findSurveys(filter, populates);
  },

  findOneSurvey(filter, populates) {
    return InterviewSurveyResponseDAO.findOneSurvey(filter, populates);
  },

  upsertSurvey(filter, payload, populates) {
    return InterviewSurveyResponseDAO.upsertSurvey(filter, payload, populates);
  },

  deleteOneSurvey(filter) {
    return InterviewSurveyResponseDAO.deleteOneSurvey(filter);
  }
};

module.exports = InterviewService;
