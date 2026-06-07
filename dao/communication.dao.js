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

  async updateCommunication(communicationId, payload) {
    return Communication.findByIdAndUpdate(communicationId, payload, {
      new: true
    })
      .populate(...POPULATE)
      .lean();
  }
};

module.exports = CommunicationDAO;
