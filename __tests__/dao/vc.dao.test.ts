// VCDAO unit tests — the DAO is a thin query-building layer over the VC
// (version control) model, so we mock the models entirely (NO database,
// in-memory or otherwise). These assert that each DAO method builds the
// expected query/options and forwards the model's result. Real query behaviour
// is covered by the integration suite (__tests__/integration), which runs
// against in-memory MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    VC: model()
  };
});

import { VC } from '../../models';
import VCDAO from '../../dao/vc.dao';

// A query chain whose terminal `.lean()` resolves to `value`.
const leanChain = (value) => {
  const chain = {
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VCDAO (mocked models)', () => {
  it('getVC forwards the filter to findOne().lean() and returns the doc', async () => {
    const doc = { _id: 'vc1', collectionName: 'Program', changes: [] };
    VC.findOne.mockReturnValue(leanChain(doc));

    const filter = { docId: 'd1' };
    const res = await VCDAO.getVC(filter);

    expect(VC.findOne).toHaveBeenCalledWith(filter);
    expect(res).toBe(doc);
  });

  it('getVC returns null when no match', async () => {
    VC.findOne.mockReturnValue(leanChain(null));

    const filter = { docId: 'missing' };
    const res = await VCDAO.getVC(filter);

    expect(VC.findOne).toHaveBeenCalledWith(filter);
    expect(res).toBeNull();
  });

  it('pushChange upserts and pushes the change entry, returning the new doc', async () => {
    const updated = { _id: 'vc1', changes: [{ field: 'name' }] };
    VC.findOneAndUpdate.mockResolvedValue(updated);

    const filter = { docId: 'd1' };
    const change = { field: 'name' };
    const res = await VCDAO.pushChange(filter, change);

    expect(VC.findOneAndUpdate).toHaveBeenCalledWith(
      filter,
      { $push: { changes: change } },
      { upsert: true, new: true }
    );
    expect(res).toBe(updated);
  });
});
