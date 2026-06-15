// KeywordSetDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose KeywordSet model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query and forwards the
// model's result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn()
  });
  return {
    KeywordSet: model()
  };
});

import { KeywordSet } from '../../models';
import KeywordSetDAO from '../../dao/keywordset.dao';

// A query chain that is BOTH chainable and thenable (awaiting it without a
// terminal `.lean()` resolves to `value`). `.sort()` returns the same chain.
const queryChain = (value) => {
  const chain = {
    sort: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('KeywordSetDAO (mocked models)', () => {
  it('getKeywordSets finds all, sorts by createdAt desc and returns the result', async () => {
    const docs = [{ _id: 'k1' }];
    const chain = queryChain(docs);
    KeywordSet.find.mockReturnValue(chain);

    const result = await KeywordSetDAO.getKeywordSets();

    expect(KeywordSet.find).toHaveBeenCalledWith({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toBe(docs);
  });

  it('findKeywordSet forwards the query to findOne and returns the doc', async () => {
    const doc = { _id: 'k3' };
    KeywordSet.findOne.mockResolvedValue(doc);
    const query = { name: 'set' };

    const result = await KeywordSetDAO.findKeywordSet(query);

    expect(KeywordSet.findOne).toHaveBeenCalledWith(query);
    expect(result).toBe(doc);
  });

  it('createKeywordSet forwards fields to create and returns the created doc', async () => {
    const created = { _id: 'k4' };
    KeywordSet.create.mockResolvedValue(created);
    const fields = { name: 'new' };

    const result = await KeywordSetDAO.createKeywordSet(fields);

    expect(KeywordSet.create).toHaveBeenCalledWith(fields);
    expect(result).toBe(created);
  });

  it('updateKeywordSetById uses findByIdAndUpdate with { new: true } and returns the doc', async () => {
    const updated = { _id: 'k5', name: 'renamed' };
    KeywordSet.findByIdAndUpdate.mockResolvedValue(updated);
    const fields = { name: 'renamed' };

    const result = await KeywordSetDAO.updateKeywordSetById('k5', fields);

    expect(KeywordSet.findByIdAndUpdate).toHaveBeenCalledWith('k5', fields, {
      new: true
    });
    expect(result).toBe(updated);
  });

  it('deleteKeywordSetById uses findByIdAndDelete and returns the result', async () => {
    const deleted = { _id: 'k6' };
    KeywordSet.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await KeywordSetDAO.deleteKeywordSetById('k6');

    expect(KeywordSet.findByIdAndDelete).toHaveBeenCalledWith('k6');
    expect(result).toBe(deleted);
  });
});
