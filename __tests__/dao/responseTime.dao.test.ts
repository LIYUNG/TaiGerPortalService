// ResponseTimeDAO unit tests — the DAO is a thin query-building layer over the
// ResponseTime Mongoose model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result.
jest.mock('../../models', () => ({
  ResponseTime: {
    bulkWrite: jest.fn(),
    find: jest.fn()
  }
}));

import { ResponseTime } from '../../models';
import ResponseTimeDAO from '../../dao/responseTime.dao';

// A query chain that is both thenable (resolves to `value` for queries not
// ending in .lean()) and chainable (.populate/.lean compose). Intermediate
// builder calls return the same chain.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ResponseTimeDAO (mocked models)', () => {
  it('bulkWrite forwards operations to ResponseTime.bulkWrite and returns the result', async () => {
    const ops = [{ updateOne: {} }];
    const res = { ok: 1 };
    ResponseTime.bulkWrite.mockResolvedValue(res);

    const result = await ResponseTimeDAO.bulkWrite(ops);

    expect(ResponseTime.bulkWrite).toHaveBeenCalledWith(ops);
    expect(result).toBe(res);
  });

  it('findByStudentId queries by student_id and returns the docs', async () => {
    const docs = [{ _id: 'r1' }];
    ResponseTime.find.mockReturnValue(queryChain(docs));

    const result = await ResponseTimeDAO.findByStudentId('stu1');

    expect(ResponseTime.find).toHaveBeenCalledWith({ student_id: 'stu1' });
    expect(result).toEqual(docs);
  });

  it('findForCommunicationPopulated filters, populates student_id and returns the lean docs', async () => {
    const docs = [{ _id: 'r1' }];
    const chain = queryChain(docs);
    ResponseTime.find.mockReturnValue(chain);

    const result = await ResponseTimeDAO.findForCommunicationPopulated();

    expect(ResponseTime.find).toHaveBeenCalledWith({
      student_id: { $exists: true }
    });
    expect(chain.populate).toHaveBeenCalledWith({
      path: 'student_id',
      populate: [
        { path: 'agents', model: 'User' },
        { path: 'editors', model: 'User' }
      ]
    });
    expect(result).toBe(docs);
  });

  it('findForThreadPopulated filters, populates thread_id and returns the lean docs', async () => {
    const docs = [{ _id: 'r2' }];
    const chain = queryChain(docs);
    ResponseTime.find.mockReturnValue(chain);

    const result = await ResponseTimeDAO.findForThreadPopulated();

    expect(ResponseTime.find).toHaveBeenCalledWith({
      thread_id: { $exists: true }
    });
    expect(chain.populate).toHaveBeenCalledWith({
      path: 'thread_id',
      populate: {
        path: 'student_id',
        model: 'User',
        populate: [
          { path: 'agents', model: 'User' },
          { path: 'editors', model: 'User' }
        ]
      }
    });
    expect(result).toBe(docs);
  });
});
