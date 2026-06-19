import { UpdateQuery } from 'mongoose';
import { INote } from '@taiger-common/model';
import { Note } from '../models';

/**
 * NoteDAO — data access for the Note model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const NoteDAO = {
  async getNoteByStudentId(studentId: string) {
    return Note.findOne({ student_id: studentId });
  },

  async upsertNoteByStudentId(studentId: string, fields: UpdateQuery<INote>) {
    return Note.findOneAndUpdate({ student_id: studentId }, fields, {
      upsert: true,
      new: true
    });
  }
};

export = NoteDAO;
