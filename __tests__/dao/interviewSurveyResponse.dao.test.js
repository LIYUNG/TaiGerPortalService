// InterviewSurveyResponseDAO unit tests — the DAO is a thin query-building
// layer over the Mongoose InterviewSurveyResponse model, so we mock the model
// entirely (NO database). These assert that each DAO method builds the expected
// query (including chained populates) and forwards the model's result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn()
  });
  return {
    InterviewSurveyResponse: model()
  };
});

const { InterviewSurveyResponse } = require('../../models');
const SurveyDAO = require('../../dao/interviewSurveyResponse.dao');

// A query chain whose terminal `.lean()` resolves to `value`. `.populate()`
// returns the same chain so applyPopulates can compose multiple calls.
const leanChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InterviewSurveyResponseDAO (mocked models)', () => {
  it('findSurveys forwards the filter, applies populates and returns lean docs', async () => {
    const docs = [{ _id: 's1' }];
    const chain = leanChain(docs);
    InterviewSurveyResponse.find.mockReturnValue(chain);
    const filter = { interview_id: 'iv1' };
    const populates = [['student_id'], ['interview_id', 'program_id']];

    const result = await SurveyDAO.findSurveys(filter, populates);

    expect(InterviewSurveyResponse.find).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledTimes(2);
    expect(chain.populate).toHaveBeenCalledWith('student_id');
    expect(chain.populate).toHaveBeenCalledWith('interview_id', 'program_id');
    expect(result).toBe(docs);
  });

  it('findSurveys defaults filter/populates and returns lean docs', async () => {
    const docs = [{ _id: 's0' }];
    const chain = leanChain(docs);
    InterviewSurveyResponse.find.mockReturnValue(chain);

    const result = await SurveyDAO.findSurveys();

    expect(InterviewSurveyResponse.find).toHaveBeenCalledWith({});
    expect(chain.populate).not.toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  it('findOneSurvey forwards the filter, applies populates and returns the lean doc', async () => {
    const doc = { _id: 's2' };
    const chain = leanChain(doc);
    InterviewSurveyResponse.findOne.mockReturnValue(chain);
    const filter = { _id: 's2' };
    const populates = [['student_id']];

    const result = await SurveyDAO.findOneSurvey(filter, populates);

    expect(InterviewSurveyResponse.findOne).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith('student_id');
    expect(result).toBe(doc);
  });

  it('upsertSurvey uses findOneAndUpdate with { new, upsert } and returns the lean doc', async () => {
    const updated = { _id: 's3', score: 5 };
    const chain = leanChain(updated);
    InterviewSurveyResponse.findOneAndUpdate.mockReturnValue(chain);
    const filter = { _id: 's3' };
    const payload = { score: 5 };

    const result = await SurveyDAO.upsertSurvey(filter, payload, [
      ['student_id']
    ]);

    expect(InterviewSurveyResponse.findOneAndUpdate).toHaveBeenCalledWith(
      filter,
      payload,
      { new: true, upsert: true }
    );
    expect(chain.populate).toHaveBeenCalledWith('student_id');
    expect(result).toBe(updated);
  });

  it('deleteOneSurvey uses findOneAndDelete and returns the result', async () => {
    const deleted = { _id: 's4' };
    InterviewSurveyResponse.findOneAndDelete.mockResolvedValue(deleted);
    const filter = { _id: 's4' };

    const result = await SurveyDAO.deleteOneSurvey(filter);

    expect(InterviewSurveyResponse.findOneAndDelete).toHaveBeenCalledWith(
      filter
    );
    expect(result).toBe(deleted);
  });
});
