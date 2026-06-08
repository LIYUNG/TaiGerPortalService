// IntervalDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose Interval model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query and forwards the
// model's result.
jest.mock('../../models', () => {
  const model = () => ({
    bulkWrite: jest.fn(),
    find: jest.fn()
  });
  return {
    Interval: model()
  };
});

const { Interval } = require('../../models');
const IntervalDAO = require('../../dao/interval.dao');

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (select/populate) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('IntervalDAO (mocked models)', () => {
  it('bulkWrite forwards operations and returns the result', async () => {
    const ops = [{ updateOne: {} }];
    const writeResult = { ok: 1, nModified: 1 };
    Interval.bulkWrite.mockResolvedValue(writeResult);

    const result = await IntervalDAO.bulkWrite(ops);

    expect(Interval.bulkWrite).toHaveBeenCalledWith(ops);
    expect(result).toBe(writeResult);
  });

  it('findAllPopulated populates thread + student and returns the lean docs', async () => {
    const docs = [{ _id: 'i1' }];
    const chain = leanChain(docs);
    Interval.find.mockReturnValue(chain);

    const result = await IntervalDAO.findAllPopulated();

    expect(Interval.find).toHaveBeenCalledWith();
    expect(chain.populate).toHaveBeenCalledWith('thread_id student_id');
    expect(result).toBe(docs);
  });

  it('findForReport applies the filter + projection and returns the lean docs', async () => {
    const docs = [{ _id: 'i2' }];
    const chain = leanChain(docs);
    Interval.find.mockReturnValue(chain);
    const filter = { thread_id: 't1' };

    const result = await IntervalDAO.findForReport(filter);

    expect(Interval.find).toHaveBeenCalledWith(filter);
    expect(chain.select).toHaveBeenCalledWith('-updatedAt -_id -student_id');
    expect(result).toBe(docs);
  });
});
