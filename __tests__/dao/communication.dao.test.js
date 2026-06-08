// CommunicationDAO unit tests — the DAO is a thin query-building layer over the
// Communication model, so we mock the model entirely (NO database, in-memory or
// otherwise). These assert that each DAO method builds the expected query and
// forwards the model's result. Real query behaviour is covered by the
// integration suite (__tests__/integration).
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn()
  });
  return {
    Communication: model()
  };
});

const { Communication } = require('../../models');
const CommunicationDAO = require('../../dao/communication.dao');

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (populate/sort/skip/limit) return the same chain so they
// compose.
const leanChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunicationDAO (mocked models)', () => {
  it('getCommunications forwards the query to find().populate().lean()', async () => {
    const docs = [{ _id: 'm1' }, { _id: 'm2' }];
    Communication.find.mockReturnValue(leanChain(docs));

    const query = { student_id: 's1' };
    const result = await CommunicationDAO.getCommunications(query);

    expect(Communication.find).toHaveBeenCalledWith(query);
    expect(result).toBe(docs);
  });

  it('getCommunicationById queries by id, populates and returns the lean doc', async () => {
    const doc = { _id: 'm1', message: 'hello' };
    Communication.findById.mockReturnValue(leanChain(doc));

    const found = await CommunicationDAO.getCommunicationById('m1');

    expect(Communication.findById).toHaveBeenCalledWith('m1');
    expect(found).toBe(doc);
  });

  it('updateCommunication uses findByIdAndUpdate with { new: true } and returns the lean doc', async () => {
    const updated = { _id: 'm1', message: 'after' };
    Communication.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const payload = { message: 'after' };
    const result = await CommunicationDAO.updateCommunication('m1', payload);

    expect(Communication.findByIdAndUpdate).toHaveBeenCalledWith(
      'm1',
      payload,
      {
        new: true
      }
    );
    expect(result).toBe(updated);
  });
});
