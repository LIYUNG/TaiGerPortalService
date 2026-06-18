import { CommunicationDraft } from '../models';

/**
 * CommunicationDraftDAO — data access for the per-(user, student) message draft
 * (default-connection model from models/index.js). Plain params, no req.
 */
const CommunicationDraftDAO = {
  async getDraft(userId, studentId) {
    return CommunicationDraft.findOne({
      user_id: userId,
      student_id: studentId
    }).lean();
  },

  async upsertDraft(userId, studentId, message) {
    return CommunicationDraft.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { message },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async deleteDraft(userId, studentId) {
    return CommunicationDraft.deleteOne({
      user_id: userId,
      student_id: studentId
    });
  }
};

export = CommunicationDraftDAO;
