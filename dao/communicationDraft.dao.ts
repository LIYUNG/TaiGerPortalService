import { CommunicationDraft as CommunicationDraftModel } from '../models';
import type { ICommunicationFile } from '@taiger-common/model';
import type {
  CommunicationDraft,
  ICommunicationDraftDAO
} from './communicationDraft.dao.types';

/**
 * Map a Mongo (lean) document to the persistence-agnostic CommunicationDraft:
 * `_id` -> `id`, ObjectId ids -> strings, defaults applied. This is the ONLY
 * place Mongo-specific shapes (`_id`, ObjectId) are allowed — everything above
 * the DAO sees a plain CommunicationDraft, which is what keeps a future
 * PostgreSQL swap confined to this file. The model is untyped (FlattenMaps<any>),
 * so the raw lean doc is `any` — this mapper is the seam that turns that loose DB
 * shape into a strict CommunicationDraft.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDomain = (doc: any): CommunicationDraft | null => {
  if (!doc) {
    return null;
  }
  return {
    id: String(doc._id),
    user_id: String(doc.user_id),
    student_id: String(doc.student_id),
    message: doc.message ?? '',
    files: Array.isArray(doc.files)
      ? doc.files.map((file: ICommunicationFile) => ({
          name: file.name,
          path: file.path
        }))
      : [],
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date
  };
};

/**
 * CommunicationDraftMongoDAO — the MongoDB strategy for the per-(user, student)
 * message draft (default-connection model from models/index.js). Implements the
 * ICommunicationDraftDAO contract; plain params in, domain objects out. Has no
 * per-instance state, so it's `new`-ed once and exported as a singleton — a
 * future PostgreSQL DAO would instead take a connection pool in its constructor.
 */
class CommunicationDraftMongoDAO implements ICommunicationDraftDAO {
  async getDraft(
    userId: string,
    studentId: string
  ): Promise<CommunicationDraft | null> {
    const doc = await CommunicationDraftModel.findOne({
      user_id: userId,
      student_id: studentId
    }).lean();
    return toDomain(doc);
  }

  async upsertDraft(
    userId: string,
    studentId: string,
    message: string
  ): Promise<CommunicationDraft> {
    const doc = await CommunicationDraftModel.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { message },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    // upsert + `new: true` always yields a document.
    return toDomain(doc) as CommunicationDraft;
  }

  async deleteDraft(userId: string, studentId: string): Promise<void> {
    await CommunicationDraftModel.deleteOne({
      user_id: userId,
      student_id: studentId
    });
  }

  // Attach: push file refs, creating the draft if none exists yet (a user can
  // attach before typing any text).
  async addDraftFiles(
    userId: string,
    studentId: string,
    files: ICommunicationFile[]
  ): Promise<CommunicationDraft> {
    const doc = await CommunicationDraftModel.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { $push: { files: { $each: files } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return toDomain(doc) as CommunicationDraft;
  }

  // Unattach: remove a single file (by its S3 key) from the draft. Returns null
  // when no draft matched.
  async removeDraftFile(
    userId: string,
    studentId: string,
    filePath: string
  ): Promise<CommunicationDraft | null> {
    const doc = await CommunicationDraftModel.findOneAndUpdate(
      { user_id: userId, student_id: studentId },
      { $pull: { files: { path: filePath } } },
      { new: true }
    ).lean();
    return toDomain(doc);
  }

  // Sweep: drafts not touched since `before` (their staged files are orphaned).
  async findStaleDrafts(before: Date): Promise<CommunicationDraft[]> {
    const docs = await CommunicationDraftModel.find({
      updatedAt: { $lt: before }
    }).lean();
    return docs
      .map((doc) => toDomain(doc))
      .filter((draft): draft is CommunicationDraft => draft !== null);
  }
}

export = new CommunicationDraftMongoDAO();
