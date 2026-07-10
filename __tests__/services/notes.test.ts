// NoteService methods are thin pass-throughs to NoteDAO. This is a UNIT test:
// the DAO is mocked so no database is touched. Each method is asserted to
// delegate to the matching DAO method with the exact args and to return the
// DAO's result unchanged.
jest.mock('../../dao/note.dao');

import NoteDAOModule from '../../dao/note.dao';
import NoteService from '../../services/notes';
import type { Note } from '../../dao/note.dao.types';

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()` calls type-check while still allowing
// partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const NoteDAO = NoteDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NoteService.getNoteByStudentId (mocked DAO)', () => {
  it('delegates to DAO.getNoteByStudentId with studentId and returns its result', async () => {
    const daoResult = { _id: 'n1', student_id: 's1', text: 'hello' };
    NoteDAO.getNoteByStudentId.mockResolvedValue(daoResult);

    const result = await NoteService.getNoteByStudentId('s1');

    expect(NoteDAO.getNoteByStudentId).toHaveBeenCalledTimes(1);
    expect(NoteDAO.getNoteByStudentId).toHaveBeenCalledWith('s1');
    expect(result).toBe(daoResult);
  });
});

describe('NoteService.upsertNoteByStudentId (mocked DAO)', () => {
  it('delegates to DAO.upsertNoteByStudentId with studentId+fields and returns its result', async () => {
    const fields = { text: 'updated' };
    const daoResult = { _id: 'n1', student_id: 's1', text: 'updated' };
    NoteDAO.upsertNoteByStudentId.mockResolvedValue(daoResult);

    const result = await NoteService.upsertNoteByStudentId(
      's1',
      fields as unknown as Partial<Note>
    );

    expect(NoteDAO.upsertNoteByStudentId).toHaveBeenCalledTimes(1);
    expect(NoteDAO.upsertNoteByStudentId).toHaveBeenCalledWith('s1', fields);
    expect(result).toBe(daoResult);
  });
});
