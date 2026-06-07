const { Communication } = require('../models');

const POPULATE = [
  'student_id user_id readBy ignoredMessageBy',
  'firstname lastname role pictureUrl'
];

/**
 * CommunicationDAO — data access for the Communication model (central
 * default-connection model). Plain params, no req.
 */
const CommunicationDAO = {
  async getCommunicationByStudentId(studentId) {
    return Communication.find({ studentId }).lean();
  },

  async getCommunicationById(communicationId) {
    return Communication.findById(communicationId)
      .populate(...POPULATE)
      .lean();
  },

  async getCommunications(query) {
    return Communication.find(query)
      .populate(...POPULATE)
      .lean();
  },

  // Full thread for a student, populated with the names/roles needed by the PDF
  // export (newest-first ordering is applied by the caller).
  async getByStudentIdForExport(studentId) {
    return Communication.find({ student_id: studentId })
      .populate(
        'student_id user_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors'
      )
      .lean();
  },

  // Most-recent messages for a student (newest first), lightly populated — used
  // by the TaiGer AI chat assistant for conversation context.
  async getRecentByStudentId(studentId, limit) {
    return Communication.find({ student_id: studentId })
      .populate('student_id user_id', 'firstname lastname role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  async updateCommunication(communicationId, payload) {
    return Communication.findByIdAndUpdate(communicationId, payload, {
      new: true
    })
      .populate(...POPULATE)
      .lean();
  }
};

module.exports = CommunicationDAO;
