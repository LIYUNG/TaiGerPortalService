import CommunicationDraftDAO from '../dao/communicationDraft.dao';

/**
 * CommunicationDraftService — business layer for message drafts. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const CommunicationDraftService = {
  getDraft(userId, studentId) {
    return CommunicationDraftDAO.getDraft(userId, studentId);
  },

  upsertDraft(userId, studentId, message) {
    return CommunicationDraftDAO.upsertDraft(userId, studentId, message);
  },

  deleteDraft(userId, studentId) {
    return CommunicationDraftDAO.deleteDraft(userId, studentId);
  },

  addDraftFiles(userId, studentId, files) {
    return CommunicationDraftDAO.addDraftFiles(userId, studentId, files);
  },

  removeDraftFile(userId, studentId, filePath) {
    return CommunicationDraftDAO.removeDraftFile(userId, studentId, filePath);
  },

  findStaleDrafts(before) {
    return CommunicationDraftDAO.findStaleDrafts(before);
  }
};

export = CommunicationDraftService;
