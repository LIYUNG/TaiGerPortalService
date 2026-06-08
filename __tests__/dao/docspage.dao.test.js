// DocspageDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose model, so we mock the model entirely (NO database). These assert that
// each DAO method forwards the expected args and returns the model's result.
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    Docspage: model()
  };
});

const { Docspage } = require('../../models');
const DocspageDAO = require('../../dao/docspage.dao');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocspageDAO (mocked models)', () => {
  it('upsertByCategory upserts by category with { upsert, new } and returns the doc', async () => {
    const updated = { _id: 'd1', category: 'visa', body: 'text' };
    Docspage.findOneAndUpdate.mockResolvedValue(updated);

    const fields = { body: 'text' };
    const result = await DocspageDAO.upsertByCategory('visa', fields);

    expect(Docspage.findOneAndUpdate).toHaveBeenCalledWith(
      { category: 'visa' },
      fields,
      { upsert: true, new: true }
    );
    expect(result).toBe(updated);
  });

  it('getByCategory queries by category and returns the doc', async () => {
    const doc = { _id: 'd2', category: 'visa' };
    Docspage.findOne.mockResolvedValue(doc);

    const result = await DocspageDAO.getByCategory('visa');

    expect(Docspage.findOne).toHaveBeenCalledWith({ category: 'visa' });
    expect(result).toBe(doc);
  });
});
