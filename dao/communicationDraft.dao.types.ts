import type { ICommunicationFile } from '@taiger-common/model';

/**
 * Persistence-agnostic message-draft entity — the shape returned by ANY
 * CommunicationDraft DAO implementation (Mongo today, PostgreSQL later). IDs are
 * plain strings (`id`, not `_id`; no ObjectId) so nothing above the DAO couples
 * to the storage engine. `files` reuses ICommunicationFile (`{ name, path }`),
 * the same ref shape a sent message carries.
 */
export interface CommunicationDraft {
  id: string;
  user_id: string;
  student_id: string;
  message: string;
  // Provenance of the current draft text: 'human' for a hand-typed draft, 'ai'
  // once an AI-generated reply has been inserted (stays 'ai' even after edits
  // so AI-assisted sends can be audited). aiOriginalMessage holds the untouched
  // AI text for "sent as-is vs edited" detection at send time.
  source: 'human' | 'ai';
  aiModel?: string;
  aiGeneratedAt?: Date;
  aiOriginalMessage?: string;
  // A generated-but-not-yet-approved AI reply (raw markdown), kept separate from
  // the editable `message` so it survives reload without clobbering typed text.
  aiPendingSuggestion?: string;
  aiPendingModel?: string;
  files: ICommunicationFile[];
  createdAt: Date;
  updatedAt: Date;
}

// Optional AI provenance, passed to upsertDraft when an AI-generated reply is
// saved as the draft. Omitted for normal human autosave (which leaves the
// existing source untouched).
export interface CommunicationDraftAiMeta {
  source: 'ai';
  aiModel?: string;
  aiOriginalMessage?: string;
}

/**
 * Strategy contract for draft data access. The service depends on THIS interface,
 * never a concrete DAO — so swapping storage engines means writing a new class/
 * object that satisfies this contract (e.g. a `communicationDraft.pg.dao.ts`) and
 * wiring it into the service factory. No change to the service or controller.
 */
export interface ICommunicationDraftDAO {
  getDraft(
    userId: string,
    studentId: string
  ): Promise<CommunicationDraft | null>;

  upsertDraft(
    userId: string,
    studentId: string,
    message: string,
    aiMeta?: CommunicationDraftAiMeta
  ): Promise<CommunicationDraft>;

  deleteDraft(userId: string, studentId: string): Promise<void>;

  // Set (or clear, when suggestion is '') a generated-but-unapproved AI reply,
  // creating the draft if none exists. Leaves `message` untouched.
  setAiPendingSuggestion(
    userId: string,
    studentId: string,
    suggestion: string,
    aiModel?: string
  ): Promise<CommunicationDraft | null>;

  addDraftFiles(
    userId: string,
    studentId: string,
    files: ICommunicationFile[]
  ): Promise<CommunicationDraft>;

  removeDraftFile(
    userId: string,
    studentId: string,
    filePath: string
  ): Promise<CommunicationDraft | null>;

  findStaleDrafts(before: Date): Promise<CommunicationDraft[]>;
}
