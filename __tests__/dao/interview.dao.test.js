// InterviewDAO unit tests — the DAO is a thin query-building layer over the
// Interview Mongoose model, so we mock the model entirely (NO database). Each
// test asserts the DAO method builds the expected query/chain and forwards the
// model's result. Real query/aggregation behaviour is covered by the
// integration suite.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    aggregate: jest.fn()
  });
  return {
    Interview: model()
  };
});

const { Interview } = require('../../models');
const InterviewDAO = require('../../dao/interview.dao');

// A query chain that is both chainable (populate returns the same chain) and
// thenable, so `await chain` (for the raw, non-lean methods) resolves to
// `value`. Terminal `.lean()` and `.distinct()` resolve to value too.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    distinct: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InterviewDAO (mocked models)', () => {
  it('getInterviews finds by filter, applies the standard populate and returns lean', async () => {
    const docs = [{ _id: 'i1' }];
    Interview.find.mockReturnValue(queryChain(docs));

    const res = await InterviewDAO.getInterviews({ isClosed: true });

    expect(Interview.find).toHaveBeenCalledWith({ isClosed: true });
    const chain = Interview.find.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'trainer_id',
      'firstname lastname email pictureUrl'
    );
    expect(chain.populate).toHaveBeenCalledWith('event_id');
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(docs);
  });

  it('getInterviewById finds by id and returns lean with the standard populate', async () => {
    const doc = { _id: 'i1' };
    Interview.findById.mockReturnValue(queryChain(doc));

    const res = await InterviewDAO.getInterviewById('i1');

    expect(Interview.findById).toHaveBeenCalledWith('i1');
    const chain = Interview.findById.mock.results[0].value;
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(doc);
  });

  it('getInterviewsByStudentId filters by student_id and returns lean', async () => {
    const docs = [{ _id: 'i1' }, { _id: 'i2' }];
    Interview.find.mockReturnValue(queryChain(docs));

    const res = await InterviewDAO.getInterviewsByStudentId('s1');

    expect(Interview.find).toHaveBeenCalledWith({ student_id: 's1' });
    const chain = Interview.find.mock.results[0].value;
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(docs);
  });

  it('findByIdRaw finds by id and returns the live (non-lean) doc', async () => {
    const doc = { _id: 'i1' };
    Interview.findById.mockReturnValue(doc);

    const res = await InterviewDAO.findByIdRaw('i1');

    expect(Interview.findById).toHaveBeenCalledWith('i1');
    expect(res).toBe(doc);
  });

  it('findInterviews applies the supplied populates and returns lean', async () => {
    const docs = [{ _id: 'i1' }];
    Interview.find.mockReturnValue(queryChain(docs));

    const res = await InterviewDAO.findInterviews({ a: 1 }, [
      ['program_id', 'school'],
      ['student_id']
    ]);

    expect(Interview.find).toHaveBeenCalledWith({ a: 1 });
    const chain = Interview.find.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith('program_id', 'school');
    expect(chain.populate).toHaveBeenCalledWith('student_id');
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(docs);
  });

  it('findInterviewByIdPopulated applies populates by id and returns lean', async () => {
    const doc = { _id: 'i1' };
    Interview.findById.mockReturnValue(queryChain(doc));

    const res = await InterviewDAO.findInterviewByIdPopulated('i1', [
      ['program_id']
    ]);

    expect(Interview.findById).toHaveBeenCalledWith('i1');
    const chain = Interview.findById.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith('program_id');
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(doc);
  });

  it('findOneInterview applies populates to findOne and returns lean', async () => {
    const doc = { _id: 'i1' };
    Interview.findOne.mockReturnValue(queryChain(doc));

    const res = await InterviewDAO.findOneInterview({ a: 1 }, [['event_id']]);

    expect(Interview.findOne).toHaveBeenCalledWith({ a: 1 });
    const chain = Interview.findOne.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith('event_id');
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(doc);
  });

  it('distinctTrainedStudentIds queries trained interviews and returns distinct ids', async () => {
    const ids = ['s1', 's2'];
    Interview.find.mockReturnValue(queryChain(ids));

    const res = await InterviewDAO.distinctTrainedStudentIds([
      's1',
      's2',
      's3'
    ]);

    expect(Interview.find).toHaveBeenCalledWith({
      student_id: { $in: ['s1', 's2', 's3'] },
      event_id: { $exists: true, $ne: null }
    });
    const chain = Interview.find.mock.results[0].value;
    expect(chain.distinct).toHaveBeenCalledWith('student_id');
    expect(res).toBe(ids);
  });

  it('updateInterviewByIdRaw updates with an empty options object', async () => {
    const updated = { _id: 'i1' };
    Interview.findByIdAndUpdate.mockResolvedValue(updated);

    const res = await InterviewDAO.updateInterviewByIdRaw('i1', { a: 1 });

    expect(Interview.findByIdAndUpdate).toHaveBeenCalledWith(
      'i1',
      { a: 1 },
      {}
    );
    expect(res).toBe(updated);
  });

  it('updateInterviewByIdPopulated updates (new:true), applies populates and returns lean', async () => {
    const updated = { _id: 'i1' };
    Interview.findByIdAndUpdate.mockReturnValue(queryChain(updated));

    const res = await InterviewDAO.updateInterviewByIdPopulated(
      'i1',
      { a: 1 },
      [['event_id']]
    );

    expect(Interview.findByIdAndUpdate).toHaveBeenCalledWith(
      'i1',
      { a: 1 },
      { new: true }
    );
    const chain = Interview.findByIdAndUpdate.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith('event_id');
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(updated);
  });

  it('upsertInterviewPopulated upserts, applies populates and returns lean', async () => {
    const upserted = { _id: 'i1' };
    Interview.findOneAndUpdate.mockReturnValue(queryChain(upserted));

    const res = await InterviewDAO.upsertInterviewPopulated(
      { a: 1 },
      { b: 2 },
      [['program_id']]
    );

    expect(Interview.findOneAndUpdate).toHaveBeenCalledWith(
      { a: 1 },
      { b: 2 },
      { upsert: true }
    );
    const chain = Interview.findOneAndUpdate.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith('program_id');
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(upserted);
  });

  it('deleteInterviewById deletes by id', async () => {
    const deleted = { _id: 'i1' };
    Interview.findByIdAndDelete.mockResolvedValue(deleted);

    const res = await InterviewDAO.deleteInterviewById('i1');

    expect(Interview.findByIdAndDelete).toHaveBeenCalledWith('i1');
    expect(res).toBe(deleted);
  });

  it('aggregateInterviews forwards the pipeline and returns the canned result', async () => {
    const pipeline = [{ $match: { isClosed: true } }];
    const aggResult = [{ _id: 'g1', count: 2 }];
    Interview.aggregate.mockResolvedValue(aggResult);

    const res = await InterviewDAO.aggregateInterviews(pipeline);

    expect(Interview.aggregate).toHaveBeenCalledWith(pipeline);
    expect(res).toBe(aggResult);
  });
});
