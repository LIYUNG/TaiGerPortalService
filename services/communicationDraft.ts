import CommunicationDraftDAO from '../dao/communicationDraft.dao';

/**
 * CommunicationDraftService — business layer for message drafts. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const CommunicationDraftService = {
  getDraft(userId: string, studentId: string) {
    return CommunicationDraftDAO.getDraft(userId, studentId);
  },

  upsertDraft(userId: string, studentId: string, message: string) {
    return CommunicationDraftDAO.upsertDraft(userId, studentId, message);
  },

  deleteDraft(userId: string, studentId: string) {
    return CommunicationDraftDAO.deleteDraft(userId, studentId);
  },

  addDraftFiles(
    userId: string,
    studentId: string,
    files: { name: string; path: string }[]
  ) {
    return CommunicationDraftDAO.addDraftFiles(userId, studentId, files);
  },

  removeDraftFile(userId: string, studentId: string, filePath: string) {
    return CommunicationDraftDAO.removeDraftFile(userId, studentId, filePath);
  },

  findStaleDrafts(before: Date) {
    return CommunicationDraftDAO.findStaleDrafts(before);
  }
};

export = CommunicationDraftService;
