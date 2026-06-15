// ProgramChangeRequestDAO unit tests — the DAO is a thin query-building layer
// over the ProgramChangeRequest model, so we mock the model entirely (NO
// database). These assert that each DAO method builds the expected
// query/options and forwards the model's result. Several methods do NOT end in
// `.lean()`, so we use a thenable chain (`queryChain`) that resolves to the
// value while still exposing chainable builder calls like `.populate()`.
jest.mock('../../models', () => ({
  ProgramChangeRequest: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn()
  }
}));

const { ProgramChangeRequest } = require('../../models');
const ProgramChangeRequestDAO = require('../../dao/programChangeRequest.dao');

// A query chain that is BOTH chainable (populate returns the chain) AND thenable
// (awaiting it resolves to `value`), for methods that don't terminate in
// `.lean()`.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProgramChangeRequestDAO (mocked ProgramChangeRequest model)', () => {
  it('getOpenChangeRequestsByProgramId filters open requests and populates requestedBy', async () => {
    const docs = [{ _id: 'cr1' }];
    const chain = queryChain(docs);
    ProgramChangeRequest.find.mockReturnValue(chain);

    const result =
      await ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId('p1');

    expect(ProgramChangeRequest.find).toHaveBeenCalledWith({
      programId: 'p1',
      reviewedBy: { $exists: false }
    });
    expect(chain.populate).toHaveBeenCalledWith(
      'requestedBy',
      'firstname lastname'
    );
    expect(result).toBe(docs);
  });

  it('upsertChangeRequest upserts the open request for the program/user', async () => {
    const res = { _id: 'cr1' };
    ProgramChangeRequest.findOneAndUpdate.mockResolvedValue(res);

    const result = await ProgramChangeRequestDAO.upsertChangeRequest(
      'p1',
      'u1',
      { tuition_fee: '1000' }
    );

    expect(ProgramChangeRequest.findOneAndUpdate).toHaveBeenCalledWith(
      {
        programId: 'p1',
        requestedBy: 'u1',
        reviewedBy: { $exists: false }
      },
      { programChanges: { tuition_fee: '1000' } },
      { upsert: true }
    );
    expect(result).toBe(res);
  });

  it('getChangeRequestById forwards the id to findById', async () => {
    const doc = { _id: 'cr1' };
    ProgramChangeRequest.findById.mockResolvedValue(doc);

    const result = await ProgramChangeRequestDAO.getChangeRequestById('cr1');

    expect(ProgramChangeRequest.findById).toHaveBeenCalledWith('cr1');
    expect(result).toBe(doc);
  });

  it('updateChangeRequestById uses findByIdAndUpdate with { new: true }', async () => {
    const updated = { _id: 'cr1', reviewedBy: 'u2' };
    ProgramChangeRequest.findByIdAndUpdate.mockResolvedValue(updated);

    const result = await ProgramChangeRequestDAO.updateChangeRequestById(
      'cr1',
      {
        reviewedBy: 'u2'
      }
    );

    expect(ProgramChangeRequest.findByIdAndUpdate).toHaveBeenCalledWith(
      'cr1',
      { reviewedBy: 'u2' },
      { new: true }
    );
    expect(result).toBe(updated);
  });
});
