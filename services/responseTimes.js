const ResponseTimeDAO = require('../dao/responseTime.dao');

/**
 * ResponseTimeService — business layer for averaged response-time records.
 * Delegates data access to the DAO (controller/util -> service -> dao).
 */
const ResponseTimeService = {
  bulkWrite(operations) {
    return ResponseTimeDAO.bulkWrite(operations);
  },

  findByStudentId(studentId) {
    return ResponseTimeDAO.findByStudentId(studentId);
  }
};

module.exports = ResponseTimeService;
