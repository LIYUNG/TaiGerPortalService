const { Interview } = require('../models');

const withPopulate = (query) =>
  query
    .populate('trainer_id', 'firstname lastname email pictureUrl')
    .populate('event_id')
    .lean();

/**
 * InterviewDAO — data access for the Interview model (central default-connection
 * model). Plain params, no req.
 */
const InterviewDAO = {
  async getInterviews(filter) {
    return withPopulate(Interview.find(filter));
  },

  async getInterviewById(id) {
    return withPopulate(Interview.findById(id));
  },

  async getInterviewsByStudentId(studentId) {
    return withPopulate(Interview.find({ student_id: studentId }));
  }
};

module.exports = InterviewDAO;
