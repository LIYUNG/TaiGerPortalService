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
  }
};

module.exports = ResponseTimeDAO;
