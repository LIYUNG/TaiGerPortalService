const CommunicationDAO = require('../dao/communication.dao');

/**
 * CommunicationService — business layer; delegates data access to the DAO
 * (controller -> service -> dao).
 */
const CommunicationService = {
  getCommunicationByStudentId(studentId) {
    return CommunicationDAO.getCommunicationByStudentId(studentId);
  },

  getCommunicationById(communicationId) {
    return CommunicationDAO.getCommunicationById(communicationId);
  },

  getCommunications(query) {
    return CommunicationDAO.getCommunications(query);
  },

  getByStudentIdForExport(studentId) {
    return CommunicationDAO.getByStudentIdForExport(studentId);
  },

  getRecentByStudentId(studentId, limit) {
    return CommunicationDAO.getRecentByStudentId(studentId, limit);
  },

  updateCommunication(communicationId, payload) {
    return CommunicationDAO.updateCommunication(communicationId, payload);
  }
};

module.exports = CommunicationService;
