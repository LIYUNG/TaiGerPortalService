import NoteDAO from '../dao/note.dao';
import type { INoteDAO, Note } from '../dao/note.dao.types';

/**
 * NoteService — business layer for student notes. Depends only on the INoteDAO
 * strategy contract (constructor injection), so the storage engine can be
 * swapped by constructing the service with a different DAO.
 */
export class NoteService {
  constructor(private readonly dao: INoteDAO) {}

  getNoteByStudentId(studentId: string) {
    return this.dao.getNoteByStudentId(studentId);
  }

  upsertNoteByStudentId(studentId: string, fields: Partial<Note>) {
    return this.dao.upsertNoteByStudentId(studentId, fields);
  }
}

// Production instance, wired to the MongoDB strategy.
const noteService = new NoteService(NoteDAO);

export default noteService;
