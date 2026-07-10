import { UpdateQuery } from 'mongoose';
import { INote } from '@taiger-common/model';
import { Note as NoteModel } from '../models';
import type { INoteDAO, Note } from './note.dao.types';

/**
 * Map a Mongo doc to the persistence-agnostic Note: keep ALL fields (the result
 * is sent to the frontend unchanged) but normalize `_id` to a string. The only
 * place Mongo shapes are handled.
 */
const toDomain = (doc: unknown): Note | null => {
  if (!doc) {
    return null;
  }
  const source = doc as { toObject?: () => Record<string, unknown> };
  const plain =
    typeof source.toObject === 'function'
      ? source.toObject()
      : (doc as Record<string, unknown>);
  return { ...plain, _id: String(plain._id) } as Note;
};

/**
 * NoteMongoDAO — MongoDB strategy for student notes (default-connection model
 * from models/index.js). Implements INoteDAO.
 */
class NoteMongoDAO implements INoteDAO {
  async getNoteByStudentId(studentId: string): Promise<Note | null> {
    const doc = await NoteModel.findOne({ student_id: studentId }).lean();
    return toDomain(doc);
  }

  async upsertNoteByStudentId(
    studentId: string,
    fields: Partial<Note>
  ): Promise<Note> {
    const doc = await NoteModel.findOneAndUpdate(
      { student_id: studentId },
      fields as UpdateQuery<INote>,
      { upsert: true, new: true }
    ).lean();
    return toDomain(doc) as Note;
  }
}

export = new NoteMongoDAO();
