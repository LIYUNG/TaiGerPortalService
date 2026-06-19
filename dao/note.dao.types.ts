import type { INote } from '@taiger-common/model';

/**
 * Persistence-agnostic student-note entity. `_id` is kept (as a STRING) so API
 * responses are byte-identical to today; all other fields come from INote.
 */
export interface Note extends Omit<INote, '_id'> {
  _id: string;
}

/**
 * Strategy contract for note data access. Domain-level params only (no Mongo
 * `UpdateQuery`), so a PostgreSQL DAO can satisfy it.
 */
export interface INoteDAO {
  getNoteByStudentId(studentId: string): Promise<Note | null>;
  upsertNoteByStudentId(
    studentId: string,
    fields: Partial<Note>
  ): Promise<Note>;
}
