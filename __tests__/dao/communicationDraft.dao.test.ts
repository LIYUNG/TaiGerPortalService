// CommunicationDraftDAO unit tests — the DAO is a thin query-building + mapping
// layer over the CommunicationDraft model, so we mock the model entirely (no
// database). Returns are the persistence-agnostic CommunicationDraft (`_id` ->
// `id`, ObjectId -> string), so assertions check the MAPPED shape, not the doc.
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

// A full Mongo-ish lean doc; the DAO maps it to a domain CommunicationDraft.
const created = new Date('2026-01-01T00:00:00.000Z');
const updated = new Date('2026-02-01T00:00:00.000Z');
const leanDoc = (overrides = {}) => ({
  _id: 'd1',
  user_id: 'u1',
  student_id: 's1',
  message: 'hello',
  files: [],
  createdAt: created,
  updatedAt: updated,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunicationDraftDAO (mocked models)', () => {
  it('getDraft finds the draft by user + student and maps to a domain object', async () => {
    CommunicationDraft.findOne.mockReturnValue(leanChain(leanDoc()));

    const result = await CommunicationDraftDAO.getDraft('u1', 's1');

    expect(CommunicationDraft.findOne).toHaveBeenCalledWith({
      user_id: 'u1',
      student_id: 's1'
    });
    expect(result).toEqual({
      id: 'd1',
      user_id: 'u1',
      student_id: 's1',
      message: 'hello',
      files: [],
      createdAt: created,
      updatedAt: updated
    });
  });

  it('getDraft returns null when there is no draft', async () => {
    CommunicationDraft.findOne.mockReturnValue(leanChain(null));

    const result = await CommunicationDraftDAO.getDraft('u1', 's1');

    expect(result).toBeNull();
  });

  it('upsertDraft upserts by user + student and returns the mapped doc', async () => {
    CommunicationDraft.findOneAndUpdate.mockReturnValue(
      leanChain(leanDoc({ message: 'hello' }))
    );

    const result = await CommunicationDraftDAO.upsertDraft('u1', 's1', 'hello');

    expect(CommunicationDraft.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: 'u1', student_id: 's1' },
      { message: 'hello' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(result).toMatchObject({ id: 'd1', message: 'hello' });
  });

  it('deleteDraft removes the draft by user + student (returns void)', async () => {
    CommunicationDraft.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await CommunicationDraftDAO.deleteDraft('u1', 's1');

    expect(CommunicationDraft.deleteOne).toHaveBeenCalledWith({
      user_id: 'u1',
      student_id: 's1'
    });
    expect(result).toBeUndefined();
  });

  it('addDraftFiles pushes files (upsert) and returns the mapped doc', async () => {
    const files = [{ name: 'a.pdf', path: 's1/chat/u1.pdf' }];
    CommunicationDraft.findOneAndUpdate.mockReturnValue(
      leanChain(leanDoc({ files }))
    );

    const result = await CommunicationDraftDAO.addDraftFiles('u1', 's1', files);

    expect(CommunicationDraft.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: 'u1', student_id: 's1' },
      { $push: { files: { $each: files } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(result).toMatchObject({ id: 'd1', files });
  });

  it('removeDraftFile pulls the file by path and returns the mapped doc', async () => {
    CommunicationDraft.findOneAndUpdate.mockReturnValue(
      leanChain(leanDoc({ files: [] }))
    );

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
    expect(result).toMatchObject({ id: 'd1', files: [] });
  });

  it('removeDraftFile returns null when no draft matched', async () => {
    CommunicationDraft.findOneAndUpdate.mockReturnValue(leanChain(null));

    const result = await CommunicationDraftDAO.removeDraftFile('u1', 's1', 'k');

    expect(result).toBeNull();
  });

  it('findStaleDrafts queries drafts older than `before` and maps them', async () => {
    const before = new Date('2026-03-01T00:00:00.000Z');
    const drafts = [
      leanDoc({ _id: 'd1' }),
      leanDoc({ _id: 'd2', user_id: 'u2', student_id: 's2' })
    ];
    CommunicationDraft.find.mockReturnValue(leanChain(drafts));

    const result = await CommunicationDraftDAO.findStaleDrafts(before);

    expect(CommunicationDraft.find).toHaveBeenCalledWith({
      updatedAt: { $lt: before }
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'd1', user_id: 'u1' });
    expect(result[1]).toMatchObject({ id: 'd2', user_id: 'u2' });
  });
});
