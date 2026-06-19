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
  files: ICommunicationFile[];
  createdAt: Date;
  updatedAt: Date;
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
    message: string
  ): Promise<CommunicationDraft>;

  deleteDraft(userId: string, studentId: string): Promise<void>;

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
