// SurveyInputDAO unit tests — the DAO is a thin query-building layer over the
// surveyInput Mongoose model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result.
jest.mock('../../models', () => ({
  surveyInput: {
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    deleteOne: jest.fn()
  }
}));

const { surveyInput } = require('../../models');
const SurveyInputDAO = require('../../dao/surveyInput.dao');

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (select) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SurveyInputDAO (mocked models)', () => {
  it('findSurveyInputs filters, selects fields and returns the lean docs', async () => {
    const filter = { programId: 'p1' };
    const docs = [{ _id: 's1' }];
    const chain = leanChain(docs);
    surveyInput.find.mockReturnValue(chain);

    const result = await SurveyInputDAO.findSurveyInputs(filter);

    expect(surveyInput.find).toHaveBeenCalledWith(filter);
    expect(chain.select).toHaveBeenCalledWith(
      'programId fileType surveyType surveyContent isFinalVersion createdAt updatedAt'
    );
    expect(result).toBe(docs);
  });

  it('getSurveyInputById queries by id and returns the lean doc', async () => {
    const doc = { _id: 's1' };
    surveyInput.findById.mockReturnValue(leanChain(doc));

    const result = await SurveyInputDAO.getSurveyInputById('s1');

    expect(surveyInput.findById).toHaveBeenCalledWith('s1');
    expect(result).toBe(doc);
  });

  it('createSurveyInput forwards the payload to create and returns the doc', async () => {
    const payload = { programId: 'p1', fileType: 'CV' };
    const created = { _id: 's1', ...payload };
    surveyInput.create.mockResolvedValue(created);

    const result = await SurveyInputDAO.createSurveyInput(payload);

    expect(surveyInput.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('updateSurveyInputById uses findByIdAndUpdate with options and returns the lean doc', async () => {
    const payload = { isFinalVersion: true };
    const updated = { _id: 's1', isFinalVersion: true };
    surveyInput.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const result = await SurveyInputDAO.updateSurveyInputById('s1', payload);

    expect(surveyInput.findByIdAndUpdate).toHaveBeenCalledWith('s1', payload, {
      upsert: false,
      new: true
    });
    expect(result).toBe(updated);
  });

  it('deleteSurveyInput forwards the filter to deleteOne and returns the result', async () => {
    const filter = { _id: 's1' };
    const res = { deletedCount: 1 };
    surveyInput.deleteOne.mockResolvedValue(res);

    const result = await SurveyInputDAO.deleteSurveyInput(filter);

    expect(surveyInput.deleteOne).toHaveBeenCalledWith(filter);
    expect(result).toBe(res);
  });
});
