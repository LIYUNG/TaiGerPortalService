const { ResponseTime } = require('../models');

/**
 * ResponseTimeDAO — data access for the ResponseTime model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const ResponseTimeDAO = {
  async bulkWrite(operations) {
    return ResponseTime.bulkWrite(operations);
  },

  async findByStudentId(studentId) {
    return ResponseTime.find({ student_id: studentId });
  },

  // Communication response-times with the student (and their agents/editors)
  // populated, for the response-time dashboards.
  async findForCommunicationPopulated() {
    return ResponseTime.find({ student_id: { $exists: true } })
      .populate({
        path: 'student_id',
        populate: [
          { path: 'agents', model: 'User' },
          { path: 'editors', model: 'User' }
        ]
      })
      .lean();
  },

  // Thread response-times with the thread's student (and their agents/editors)
  // populated.
  async findForThreadPopulated() {
    return ResponseTime.find({ thread_id: { $exists: true } })
      .populate({
        path: 'thread_id',
        populate: {
          path: 'student_id',
          model: 'User',
          populate: [
            { path: 'agents', model: 'User' },
            { path: 'editors', model: 'User' }
          ]
        }
      })
      .lean();
  }
};

module.exports = ResponseTimeDAO;
