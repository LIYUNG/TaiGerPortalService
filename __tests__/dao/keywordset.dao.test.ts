// KeywordSetDAO unit tests — the DAO is a thin query-building + mapping layer
// over the Mongoose KeywordSet model, so we mock the model entirely (NO
// database). Returns keep all fields but normalize `_id` to a string, so
// assertions check the MAPPED result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn()
  });
  return {
    KeywordSet: model()
  };
});

import { KeywordSet as KeywordSetModel } from '../../models';
import KeywordSetDAO from '../../dao/keywordset.dao';

// The model is auto-mocked above (every method is a jest.fn()); retype it so
// the mock API (mockReturnValue/…) is visible to the type-checker.
const KeywordSet = KeywordSetModel as unknown as Record<string, jest.Mock>;

// A chain whose terminal `.lean()` resolves to `value`.
const leanChain = (value: unknown): any => ({
  lean: jest.fn().mockResolvedValue(value)
});

// `find().sort().lean()` — `.sort()` returns the same chain.
const sortLeanChain = (value: unknown): any => {
  const chain: any = {
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('KeywordSetDAO (mocked models)', () => {
  it('getKeywordSets finds all, sorts by createdAt desc and returns mapped sets', async () => {
    const chain = sortLeanChain([{ _id: 'k1' }, { _id: 'k2' }]);
    KeywordSet.find.mockReturnValue(chain);

    const result = await KeywordSetDAO.getKeywordSets();

    expect(KeywordSet.find).toHaveBeenCalledWith({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toEqual([{ _id: 'k1' }, { _id: 'k2' }]);
  });

  it('findKeywordSet builds the dedup $or query and maps the doc', async () => {
    KeywordSet.findOne.mockReturnValue(leanChain({ _id: 'k3' }));
    const match = {
      keywords: { zh: ['a'], en: ['b'] },
      antiKeywords: { zh: ['c'], en: ['d'] }
    };

    const result = await KeywordSetDAO.findKeywordSet(match);

    expect(KeywordSet.findOne).toHaveBeenCalledWith({
      $or: [
        {
          $and: [
            { 'keywords.zh': { $in: ['a'] } },
            { 'antiKeywords.zh': { $in: ['c'] } }
          ]
        },
        {
          $and: [
            { 'keywords.en': { $in: ['b'] } },
            { 'antiKeywords.en': { $in: ['d'] } }
          ]
        }
      ]
    });
    expect(result).toMatchObject({ _id: 'k3' });
  });

  it('findKeywordSet returns null when no set matches', async () => {
    KeywordSet.findOne.mockReturnValue(leanChain(null));

    const result = await KeywordSetDAO.findKeywordSet({
      keywords: { zh: [], en: [] },
      antiKeywords: { zh: [], en: [] }
    });

    expect(result).toBeNull();
  });

  it('createKeywordSet forwards fields to create and returns the mapped doc', async () => {
    KeywordSet.create.mockResolvedValue({ _id: 'k4', categoryName: 'new' });

    const result = await KeywordSetDAO.createKeywordSet({
      categoryName: 'new'
    });

    expect(KeywordSet.create).toHaveBeenCalledWith({ categoryName: 'new' });
    expect(result).toMatchObject({ _id: 'k4', categoryName: 'new' });
  });

  it('updateKeywordSetById uses findByIdAndUpdate with { new: true } and maps', async () => {
    KeywordSet.findByIdAndUpdate.mockReturnValue(
      leanChain({ _id: 'k5', categoryName: 'renamed' })
    );

    const result = await KeywordSetDAO.updateKeywordSetById('k5', {
      categoryName: 'renamed'
    });

    expect(KeywordSet.findByIdAndUpdate).toHaveBeenCalledWith(
      'k5',
      { categoryName: 'renamed' },
      { new: true }
    );
    expect(result).toMatchObject({ _id: 'k5', categoryName: 'renamed' });
  });

  it('deleteKeywordSetById deletes by id and returns void', async () => {
    KeywordSet.findByIdAndDelete.mockResolvedValue({ _id: 'k6' });

    const result = await KeywordSetDAO.deleteKeywordSetById('k6');

    expect(KeywordSet.findByIdAndDelete).toHaveBeenCalledWith('k6');
    expect(result).toBeUndefined();
  });
});
