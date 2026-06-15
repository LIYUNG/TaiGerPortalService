import CommunicationDAO from '../dao/communication.dao';

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

  getAllForIntervalGrouping() {
    return CommunicationDAO.getAllForIntervalGrouping();
  },

  findPopulatedSorted(filter, options) {
    return CommunicationDAO.findPopulatedSorted(filter, options);
  },

  getByStudentIdForExport(studentId) {
    return CommunicationDAO.getByStudentIdForExport(studentId);
  },

  getRecentByStudentId(studentId, limit) {
    return CommunicationDAO.getRecentByStudentId(studentId, limit);
  },

  updateCommunication(communicationId, payload) {
    return CommunicationDAO.updateCommunication(communicationId, payload);
  },

  createCommunication(payload) {
    return CommunicationDAO.createCommunication(payload);
  },

  deleteById(communicationId) {
    return CommunicationDAO.deleteById(communicationId);
  },

  getLatestByStudentId(studentId) {
    return CommunicationDAO.getLatestByStudentId(studentId);
  },

  findThreadPopulated(studentId, options) {
    return CommunicationDAO.findThreadPopulated(studentId, options);
  }
};

export = CommunicationService;
