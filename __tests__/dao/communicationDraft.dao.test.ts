// CommunicationDraftDAO unit tests — the DAO is a thin query-building layer over
// the CommunicationDraft model, so we mock the model entirely (no database).
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn()
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

  it('addDraftFiles pushes files (upsert) and returns the new lean doc', async () => {
    const files = [{ name: 'a.pdf', path: 's1/chat/u1.pdf' }];
    const doc = { _id: 'd1', files };
    CommunicationDraft.findOneAndUpdate.mockReturnValue(leanChain(doc));

    const result = await CommunicationDraftDAO.addDraftFiles('u1', 's1', files);

    expect(CommunicationDraft.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: 'u1', student_id: 's1' },
      { $push: { files: { $each: files } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(result).toBe(doc);
  });

  it('removeDraftFile pulls the file by path and returns the new lean doc', async () => {
    const doc = { _id: 'd1', files: [] };
    CommunicationDraft.findOneAndUpdate.mockReturnValue(leanChain(doc));

    const result = await CommunicationDraftDAO.removeDraftFile(
      'u1',
      's1',
      's1/chat/u1.pdf'
    );

    expect(CommunicationDraft.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: 'u1', student_id: 's1' },
      { $pull: { files: { path: 's1/chat/u1.pdf' } } },
      { new: true }
    );
    expect(result).toBe(doc);
  });

  it('findStaleDrafts queries drafts older than `before` (lean)', async () => {
    const before = new Date('2026-01-01T00:00:00.000Z');
    const drafts = [{ _id: 'd1' }, { _id: 'd2' }];
    CommunicationDraft.find.mockReturnValue(leanChain(drafts));

    const result = await CommunicationDraftDAO.findStaleDrafts(before);

    expect(CommunicationDraft.find).toHaveBeenCalledWith({
      updatedAt: { $lt: before }
    });
    expect(result).toBe(drafts);
  });
});
