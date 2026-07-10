import { CommunicationDraft as CommunicationDraftModel } from '../models';
import type { ICommunicationFile } from '@taiger-common/model';
import type {
  CommunicationDraft,
  CommunicationDraftAiMeta,
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
// Raw lean shape of a persisted draft. The model is untyped (see file header),
// so this local interface documents the fields the mapper reads off the DB doc.
interface RawCommunicationDraftDoc {
  _id: unknown;
  user_id: unknown;
  student_id: unknown;
  message?: string;
  source?: string;
  aiModel?: string;
  aiGeneratedAt?: Date;
  aiOriginalMessage?: string;
  aiPendingSuggestion?: string;
  aiPendingModel?: string;
  files?: ICommunicationFile[];
  createdAt?: Date;
  updatedAt?: Date;
}

const toDomain = (doc: unknown): CommunicationDraft | null => {
  if (!doc) {
    return null;
  }
  const d = doc as RawCommunicationDraftDoc;
  return {
    id: String(d._id),
    user_id: String(d.user_id),
    student_id: String(d.student_id),
    message: d.message ?? '',
    source: d.source === 'ai' ? 'ai' : 'human',
    aiModel: d.aiModel ?? '',
    aiGeneratedAt: d.aiGeneratedAt,
    aiOriginalMessage: d.aiOriginalMessage ?? '',
    aiPendingSuggestion: d.aiPendingSuggestion ?? '',
    aiPendingModel: d.aiPendingModel ?? '',
    files: Array.isArray(d.files)
      ? d.files.map((file: ICommunicationFile) => ({
          name: file.name,
          path: file.path
        }))
      : [],
    createdAt: d.createdAt as Date,
    updatedAt: d.updatedAt as Date
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
    message: string,
    aiMeta?: CommunicationDraftAiMeta
  ): Promise<CommunicationDraft> {
    // Normal human autosave only touches `message`, leaving any existing
    // provenance intact. When aiMeta is supplied (an AI reply was inserted),
    // stamp the source + model + the untouched AI text for later audit.
    // Coerce every user-derived value to a primitive string before it reaches
    // the query, so a malicious object (e.g. Mongo query operators) can't be
    // injected through the filter or the update document (NoSQL injection).
    const safeMessage = String(message ?? '');
    const update = aiMeta
      ? {
          message: safeMessage,
          source: 'ai',
          aiModel: String(aiMeta.aiModel ?? ''),
          aiGeneratedAt: new Date(),
          aiOriginalMessage: String(aiMeta.aiOriginalMessage ?? safeMessage),
          // Approving an AI reply consumes any pending suggestion.
          aiPendingSuggestion: '',
          aiPendingModel: ''
        }
      : { message: safeMessage };
    const doc = await CommunicationDraftModel.findOneAndUpdate(
      { user_id: String(userId), student_id: String(studentId) },
      update,
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

  // Persist (or clear, when suggestion is '') a generated-but-unapproved AI
  // reply. Upserts so the suggestion can be stored before any human text exists.
  async setAiPendingSuggestion(
    userId: string,
    studentId: string,
    suggestion: string,
    aiModel?: string
  ): Promise<CommunicationDraft | null> {
    // Coerce user-derived values to strings before the query (NoSQL injection).
    const doc = await CommunicationDraftModel.findOneAndUpdate(
      { user_id: String(userId), student_id: String(studentId) },
      {
        aiPendingSuggestion: String(suggestion ?? ''),
        aiPendingModel: String(aiModel ?? '')
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return toDomain(doc);
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
