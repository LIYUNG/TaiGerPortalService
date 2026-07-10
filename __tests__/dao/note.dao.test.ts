// NoteDAO unit tests — the DAO is a thin query + mapping layer over the Mongoose
// Note model, so we mock the model entirely (NO database). Returns keep all
// fields but normalize `_id` to a string, so assertions check the MAPPED result.
// Real query behaviour is covered by the integration suite.
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    Note: model()
  };
});

import { Note as NoteModel } from '../../models';
import NoteDAO from '../../dao/note.dao';

// The model is auto-mocked above (every method is a jest.fn()); retype it so
// the mock API (mockReturnValue/…) is visible to the type-checker.
const Note = NoteModel as unknown as Record<string, jest.Mock>;

// A chain whose terminal `.lean()` resolves to `value`.
const leanChain = (value: unknown): any => ({
  lean: jest.fn().mockResolvedValue(value)
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NoteDAO (mocked models)', () => {
  it('getNoteByStudentId queries by student_id and maps the doc', async () => {
    Note.findOne.mockReturnValue(
      leanChain({ _id: 'n1', student_id: 's1', notes: 'hi' })
    );

    const found = await NoteDAO.getNoteByStudentId('s1');

    expect(Note.findOne).toHaveBeenCalledWith({ student_id: 's1' });
    expect(found).toMatchObject({ _id: 'n1', student_id: 's1', notes: 'hi' });
  });

  it('getNoteByStudentId returns null when no note exists', async () => {
    Note.findOne.mockReturnValue(leanChain(null));

    expect(await NoteDAO.getNoteByStudentId('s1')).toBeNull();
  });

  it('upsertNoteByStudentId upserts with { upsert: true, new: true } and maps', async () => {
    Note.findOneAndUpdate.mockReturnValue(
      leanChain({ _id: 'n1', student_id: 's1', notes: 'updated note' })
    );

    const result = await NoteDAO.upsertNoteByStudentId('s1', {
      notes: 'updated note'
    });

    expect(Note.findOneAndUpdate).toHaveBeenCalledWith(
      { student_id: 's1' },
      { notes: 'updated note' },
      { upsert: true, new: true }
    );
    expect(result).toMatchObject({
      _id: 'n1',
      student_id: 's1',
      notes: 'updated note'
    });
  });
});
