import { CommunicationDraft } from '../models';

/**
 * CommunicationDraftDAO — data access for the per-(user, student) message draft
 * (default-connection model from models/index.js). Plain params, no req.
 */
const CommunicationDraftDAO = {
  async getDraft(userId: string, studentId: string) {
    return CommunicationDraft.findOne({
      user_id: userId,
      student_id: studentId
    }).lean();
  },

  async upsertDraft(userId: string, studentId: string, message: string) {
    return CommunicationDraft.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { message },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async deleteDraft(userId: string, studentId: string) {
    return CommunicationDraft.deleteOne({
      user_id: userId,
      student_id: studentId
    });
  },

  // Attach: push file refs, creating the draft if none exists yet (a user can
  // attach before typing any text).
  async addDraftFiles(
    userId: string,
    studentId: string,
    files: { name: string; path: string }[]
  ) {
    return CommunicationDraft.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { $push: { files: { $each: files } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  },

  // Unattach: remove a single file (by its S3 key) from the draft.
  async removeDraftFile(userId: string, studentId: string, filePath: string) {
    return CommunicationDraft.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { $pull: { files: { path: filePath } } },
      { new: true }
    ).lean();
  },

  // Sweep: drafts not touched since `before` (their staged files are orphaned).
  async findStaleDrafts(before: Date) {
    return CommunicationDraft.find({ updatedAt: { $lt: before } }).lean();
  }
};

export = CommunicationDraftDAO;
