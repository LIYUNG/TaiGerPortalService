// CommunicationDraftDAO unit tests — the DAO is a thin query-building layer over
// the CommunicationDraft model, so we mock the model entirely (no database).
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn()
  });
  return {
    CommunicationDraft: model()
  };
});

import { CommunicationDraft } from '../../models';
import CommunicationDraftDAO from '../../dao/communicationDraft.dao';

// A query chain whose terminal `.lean()` resolves to `value`.
const leanChain = (value) => ({
  lean: jest.fn().mockResolvedValue(value)
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunicationDraftDAO (mocked models)', () => {
  it('getDraft finds the draft by user + student and returns the lean doc', async () => {
    const doc = { _id: 'd1', message: '{"blocks":[]}' };
    CommunicationDraft.findOne.mockReturnValue(leanChain(doc));

    const result = await CommunicationDraftDAO.getDraft('u1', 's1');

    expect(CommunicationDraft.findOne).toHaveBeenCalledWith({
      user_id: 'u1',
      student_id: 's1'
    });
    expect(result).toBe(doc);
  });

  it('upsertDraft upserts by user + student and returns the new lean doc', async () => {
    const doc = { _id: 'd1', message: 'hello' };
    CommunicationDraft.findOneAndUpdate.mockReturnValue(leanChain(doc));

    const result = await CommunicationDraftDAO.upsertDraft('u1', 's1', 'hello');

    expect(CommunicationDraft.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: 'u1', student_id: 's1' },
      { message: 'hello' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(result).toBe(doc);
  });

  it('deleteDraft removes the draft by user + student', async () => {
    const res = { deletedCount: 1 };
    CommunicationDraft.deleteOne.mockResolvedValue(res);

    const result = await CommunicationDraftDAO.deleteDraft('u1', 's1');

    expect(CommunicationDraft.deleteOne).toHaveBeenCalledWith({
      user_id: 'u1',
      student_id: 's1'
    });
    expect(result).toBe(res);
  });
});
