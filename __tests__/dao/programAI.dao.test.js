// ProgramAIDAO unit tests — the DAO is a thin query-building layer over the
// ProgramAI model, so we mock the model entirely (NO database). These assert
// that each DAO method builds the expected query and forwards the model's
// result.
jest.mock('../../models', () => ({
  ProgramAI: {
    findOne: jest.fn()
  }
}));

const { ProgramAI } = require('../../models');
const ProgramAIDAO = require('../../dao/programAI.dao');

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

describe('ProgramAIDAO (mocked ProgramAI model)', () => {
  it('getByProgramId queries by program_id and returns the lean doc', async () => {
    const doc = { _id: 'ai1', program_id: 'p1' };
    ProgramAI.findOne.mockReturnValue(leanChain(doc));

    const found = await ProgramAIDAO.getByProgramId('p1');

    expect(ProgramAI.findOne).toHaveBeenCalledWith({ program_id: 'p1' });
    expect(found).toBe(doc);
  });

  it('getByProgramId returns null when no doc matches', async () => {
    ProgramAI.findOne.mockReturnValue(leanChain(null));

    const found = await ProgramAIDAO.getByProgramId('missing');

    expect(ProgramAI.findOne).toHaveBeenCalledWith({ program_id: 'missing' });
    expect(found).toBeNull();
  });
});
