// BasedocumentationslinkDAO unit tests — the DAO is a thin query-building layer
// over the Mongoose model, so we mock the model entirely (NO database). These
// assert that each DAO method forwards the expected args and returns the model's
// result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    Basedocumentationslink: model()
  };
});

import { Basedocumentationslink } from '../../models';
import BasedocumentationslinkDAO from '../../dao/basedocumentationslink.dao';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BasedocumentationslinkDAO (mocked models)', () => {
  it('findByCategory queries by category and returns the result', async () => {
    const docs = [{ _id: 'b1', category: 'visa' }];
    Basedocumentationslink.find.mockResolvedValue(docs);

    const result = await BasedocumentationslinkDAO.findByCategory('visa');

    expect(Basedocumentationslink.find).toHaveBeenCalledWith({
      category: 'visa'
    });
    expect(result).toBe(docs);
  });

  it('upsertByCategoryKey upserts by { category, key } with $set and returns the doc', async () => {
    const updated = { _id: 'b2', category: 'visa', key: 'k1' };
    Basedocumentationslink.findOneAndUpdate.mockResolvedValue(updated);

    const set = { link: 'https://example.com' };
    const result = await BasedocumentationslinkDAO.upsertByCategoryKey(
      'visa',
      'k1',
      set
    );

    expect(Basedocumentationslink.findOneAndUpdate).toHaveBeenCalledWith(
      { category: 'visa', key: 'k1' },
      { $set: set },
      { upsert: true }
    );
    expect(result).toBe(updated);
  });
});
