import { UpdateQuery } from 'mongoose';
import { INote } from '@taiger-common/model';
import NoteDAO from '../dao/note.dao';

/**
 * NoteService — business layer for student notes. Delegates data access to the
 * DAO (controller -> service -> dao).
 */
const NoteService = {
  getNoteByStudentId(studentId: string) {
    return NoteDAO.getNoteByStudentId(studentId);
  },

  upsertNoteByStudentId(studentId: string, fields: UpdateQuery<INote>) {
    return NoteDAO.upsertNoteByStudentId(studentId, fields);
  }
};

export = NoteService;
