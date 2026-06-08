// ProgramRequirementDAO unit tests — the DAO is a thin query-building layer over
// the ProgramRequirement model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result. Methods that end in `.lean()` use `leanChain`;
// chains that terminate on a builder (e.g. `.sort()`) use a thenable
// `queryChain`.
jest.mock('../../models', () => ({
  ProgramRequirement: {
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOneAndDelete: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn()
  }
}));

const { ProgramRequirement } = require('../../models');
const ProgramRequirementDAO = require('../../dao/programRequirement.dao');

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

// A query chain that is BOTH chainable AND thenable, for chains that terminate
// on a builder (e.g. `.sort()`) rather than `.lean()`.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => Promise.resolve(value))
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProgramRequirementDAO (mocked ProgramRequirement model)', () => {
  it('getProgramRequirements finds all, populates and sorts by createdAt desc', async () => {
    const docs = [{ _id: 'r1' }];
    const chain = queryChain(docs);
    ProgramRequirement.find.mockReturnValue(chain);

    const result = await ProgramRequirementDAO.getProgramRequirements();

    expect(ProgramRequirement.find).toHaveBeenCalledWith({});
    expect(chain.populate).toHaveBeenCalledWith(
      'programId program_categories.keywordSets'
    );
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toBe(docs);
  });

  it('getProgramRequirementById finds by id, populates twice and returns the lean doc', async () => {
    const doc = { _id: 'r1' };
    const chain = leanChain(doc);
    ProgramRequirement.findById.mockReturnValue(chain);

    const result = await ProgramRequirementDAO.getProgramRequirementById('r1');

    expect(ProgramRequirement.findById).toHaveBeenCalledWith('r1');
    expect(chain.populate).toHaveBeenNthCalledWith(
      1,
      'programId',
      'school program_name degree'
    );
    expect(chain.populate).toHaveBeenNthCalledWith(
      2,
      'program_categories.keywordSets'
    );
    expect(result).toBe(doc);
  });

  it('getProgramRequirementsByProgramIds filters by programId and returns the lean docs', async () => {
    const docs = [{ _id: 'r1' }];
    ProgramRequirement.find.mockReturnValue(leanChain(docs));

    const result =
      await ProgramRequirementDAO.getProgramRequirementsByProgramIds([
        'p1',
        'p2'
      ]);

    expect(ProgramRequirement.find).toHaveBeenCalledWith({
      programId: ['p1', 'p2']
    });
    expect(result).toBe(docs);
  });

  it('createProgramRequirement forwards the payload to create', async () => {
    const payload = { programId: 'p1' };
    const created = { _id: 'r1', ...payload };
    ProgramRequirement.create.mockResolvedValue(created);

    const result = await ProgramRequirementDAO.createProgramRequirement(
      payload
    );

    expect(ProgramRequirement.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('updateProgramRequirementById uses findByIdAndUpdate with { upsert: false, new: true }', async () => {
    const updated = { _id: 'r1', updated: true };
    ProgramRequirement.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const result = await ProgramRequirementDAO.updateProgramRequirementById(
      'r1',
      { updated: true }
    );

    expect(ProgramRequirement.findByIdAndUpdate).toHaveBeenCalledWith(
      'r1',
      { updated: true },
      { upsert: false, new: true }
    );
    expect(result).toBe(updated);
  });

  it('deleteProgramRequirementById forwards the id to findByIdAndDelete', async () => {
    const deleted = { _id: 'r1' };
    ProgramRequirement.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await ProgramRequirementDAO.deleteProgramRequirementById(
      'r1'
    );

    expect(ProgramRequirement.findByIdAndDelete).toHaveBeenCalledWith('r1');
    expect(result).toBe(deleted);
  });

  it('deleteOneByProgramIds deletes one matching $in programId', async () => {
    const deleted = { _id: 'r1' };
    ProgramRequirement.findOneAndDelete.mockResolvedValue(deleted);

    const result = await ProgramRequirementDAO.deleteOneByProgramIds([
      'p1',
      'p2'
    ]);

    expect(ProgramRequirement.findOneAndDelete).toHaveBeenCalledWith({
      programId: { $in: ['p1', 'p2'] }
    });
    expect(result).toBe(deleted);
  });

  it('removeKeywordSetReferences pulls the keyword set id from every requirement', async () => {
    const res = { matchedCount: 2, modifiedCount: 2 };
    ProgramRequirement.updateMany.mockResolvedValue(res);

    const result = await ProgramRequirementDAO.removeKeywordSetReferences(
      'ks1'
    );

    expect(ProgramRequirement.updateMany).toHaveBeenCalledWith(
      { 'program_categories.keywordSets': 'ks1' },
      { $pull: { 'program_categories.$[].keywordSets': 'ks1' } }
    );
    expect(result).toBe(res);
  });
});
