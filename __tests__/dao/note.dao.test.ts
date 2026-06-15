// NoteDAO unit tests — the DAO is a thin query-building layer over the Mongoose
// models, so we mock the models entirely (NO database, in-memory or otherwise).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result. Real query behaviour is covered by the
// integration suite (__tests__/integration), which runs against in-memory
// MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    Note: model()
  };
});

const { Note } = require('../../models');
const NoteDAO = require('../../dao/note.dao');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NoteDAO (mocked models)', () => {
  it('getNoteByStudentId queries by student_id and returns the doc', async () => {
    const doc = { _id: 'n1', student_id: 's1', notes: 'hi' };
    Note.findOne.mockResolvedValue(doc);

    const found = await NoteDAO.getNoteByStudentId('s1');

    expect(Note.findOne).toHaveBeenCalledWith({ student_id: 's1' });
    expect(found).toBe(doc);
  });

  it('upsertNoteByStudentId upserts with { upsert: true, new: true } and returns the doc', async () => {
    const updated = { _id: 'n1', student_id: 's1', notes: 'updated note' };
    Note.findOneAndUpdate.mockResolvedValue(updated);

    const result = await NoteDAO.upsertNoteByStudentId('s1', {
      notes: 'updated note'
    });

    expect(Note.findOneAndUpdate).toHaveBeenCalledWith(
      { student_id: 's1' },
      { notes: 'updated note' },
      { upsert: true, new: true }
    );
    expect(result).toBe(updated);
  });
});
