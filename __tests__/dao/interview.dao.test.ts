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

import { Interview } from '../../models';
import InterviewDAO from '../../dao/interview.dao';

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

// Aggregate returns a cursor-like object exposing .allowDiskUse(true) which
// resolves to the aggregation result (an array with the single $facet doc).
const aggChain = (value) => ({
  allowDiskUse: jest.fn().mockResolvedValue(value)
});

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

  it('studentInterviewProgramIds returns distinct program ids as strings (drops null)', async () => {
    Interview.find.mockReturnValue(
      queryChain([{ toString: () => 'p1' }, null, { toString: () => 'p2' }])
    );

    const res = await InterviewDAO.studentInterviewProgramIds('s1');

    expect(Interview.find).toHaveBeenCalledWith({ student_id: 's1' });
    const chain = Interview.find.mock.results[0].value;
    expect(chain.distinct).toHaveBeenCalledWith('program_id');
    expect(res).toEqual(['p1', 'p2']);
  });

  describe('getInterviewsPaginated', () => {
    it('hydrates the page of ids, re-attaches computed columns and returns total/page/limit', async () => {
      const facet = [
        {
          rows: [
            {
              _id: 'i2',
              status: 'Open',
              isDuplicate: true,
              surveySubmitted: false
            },
            {
              _id: 'i1',
              status: 'Closed',
              isDuplicate: false,
              surveySubmitted: true
            }
          ],
          total: [{ count: 7 }]
        }
      ];
      Interview.aggregate.mockReturnValue(aggChain(facet));
      // find returns the two docs in a different order than the aggregation.
      Interview.find.mockReturnValue(
        queryChain([
          { _id: 'i1', student_id: { _id: 's1' } },
          { _id: 'i2', student_id: { _id: 's2' } }
        ])
      );

      const res = await InterviewDAO.getInterviewsPaginated({
        filter: {},
        query: { page: '1', limit: '20' }
      });

      expect(Interview.aggregate).toHaveBeenCalled();
      expect(Interview.find).toHaveBeenCalledWith({
        _id: { $in: ['i2', 'i1'] }
      });
      expect(res.total).toBe(7);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(20);
      // Order follows the aggregation (i2 then i1), not the find() order.
      expect(res.interviews.map((i) => i._id)).toEqual(['i2', 'i1']);
      // Computed columns from the aggregation are merged onto the hydrated docs.
      expect(res.interviews[0]).toMatchObject({
        _id: 'i2',
        status: 'Open',
        isDuplicate: true,
        surveySubmitted: false
      });
      expect(res.interviews[1]).toMatchObject({
        _id: 'i1',
        status: 'Closed',
        isDuplicate: false,
        surveySubmitted: true
      });
    });

    it('short-circuits hydration when the page is empty', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      const res = await InterviewDAO.getInterviewsPaginated({
        filter: { student_id: 's1' },
        query: { page: '3', limit: '10' }
      });

      expect(res).toEqual({
        interviews: [],
        total: 0,
        page: 3,
        limit: 10
      });
      expect(Interview.find).not.toHaveBeenCalled();
    });

    it('clamps limit to the 100 max and defaults page to 1', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      const res = await InterviewDAO.getInterviewsPaginated({
        query: { limit: '5000' }
      });

      expect(res.page).toBe(1);
      expect(res.limit).toBe(100);
    });

    it('builds a post-match for every filter + search and honours sortBy/sortOrder', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({
        filter: {},
        query: {
          status: 'Open,Closed',
          isDuplicate: 'true',
          surveySubmitted: 'false',
          studentName: 'alice',
          trainerName: 'bob',
          program: 'mit',
          search: 'data',
          sortBy: 'firstname_lastname',
          sortOrder: 'asc'
        }
      });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      // The $facet sort stage reflects sortBy/sortOrder (asc) + _id tiebreak.
      const facetStage = pipeline.find((s) => s.$facet);
      expect(facetStage.$facet.rows[0]).toEqual({
        $sort: { 'student.firstname': 1, _id: 1 }
      });

      // The post-match $and carries one condition per active filter + search.
      const matchStages = pipeline.filter((s) => s.$match && s.$match.$and);
      expect(matchStages).toHaveLength(1);
      const and = matchStages[0].$match.$and;
      expect(and).toContainEqual({ status: { $in: ['Open', 'Closed'] } });
      expect(and).toContainEqual({ isDuplicate: true });
      expect(and).toContainEqual({ surveySubmitted: false });
      // studentName / trainerName / program / search each add an $or group.
      expect(and.filter((c) => c.$or)).toHaveLength(4);
    });

    it('joins the student agents and adds an agentName $or filter over their names', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({
        filter: {},
        query: { agentName: 'leo' }
      });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      // The agent lookup (student.agents -> users) is present and aliased 'agent'.
      const agentLookup = pipeline.find(
        (s) => s.$lookup && s.$lookup.as === 'agent'
      );
      expect(agentLookup).toBeDefined();

      // The page projection carries the agents through to hydration.
      const facetStage = pipeline.find((s) => s.$facet);
      const projection = facetStage.$facet.rows.find(
        (s) => s.$project
      ).$project;
      expect(projection.agents).toBe('$agent');

      // The post-match carries an $or over the agent-name paths.
      const and = pipeline.find((s) => s.$match && s.$match.$and).$match.$and;
      expect(and).toContainEqual({
        $or: [
          { 'agent.firstname': { $regex: 'leo', $options: 'i' } },
          { 'agent.lastname': { $regex: 'leo', $options: 'i' } }
        ]
      });
    });

    it('adds inclusive eventStart / interview_date range conditions for date filters', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({
        filter: {},
        query: {
          trainingTimeFrom: '2025-06-01',
          trainingTimeTo: '2025-06-30',
          interviewTimeFrom: '2025-07-01'
        }
      });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      const and = pipeline.find((s) => s.$match && s.$match.$and).$match.$and;

      const training = and.find((c) => c.eventStart);
      expect(training.eventStart.$gte).toEqual(new Date('2025-06-01'));
      // "to" is pushed to end-of-day so the whole day is included.
      const expectedTo = new Date('2025-06-30');
      expectedTo.setHours(23, 59, 59, 999);
      expect(training.eventStart.$lte).toEqual(expectedTo);

      // interview_date with only a "from" bound -> $gte, no $lte.
      const interview = and.find((c) => c.interview_date);
      expect(interview.interview_date.$gte).toEqual(new Date('2025-07-01'));
      expect(interview.interview_date.$lte).toBeUndefined();
    });

    it('ignores invalid / empty date filter values', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({
        filter: {},
        query: { trainingTimeFrom: 'not-a-date', interviewTimeTo: '' }
      });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      // No valid filters/search -> no post-match $and stage at all.
      expect(pipeline.filter((s) => s.$match && s.$match.$and)).toHaveLength(0);
    });

    it('casts a string student_id / trainer_id to ObjectId and isClosed to boolean in the base $match (aggregation does not auto-cast)', async () => {
      const mongoose = require('mongoose');
      const sid = '5f9f1b9b9c9d440000a1a1a1';
      const tid = '5f9f1b9b9c9d440000b2b2b2';
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({
        filter: { student_id: sid, trainer_id: tid, isClosed: 'true' },
        query: {}
      });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      const baseMatch = pipeline[0].$match;
      expect(baseMatch.student_id).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(baseMatch.student_id.toString()).toBe(sid);
      expect(baseMatch.trainer_id).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(baseMatch.trainer_id.toString()).toBe(tid);
      expect(baseMatch.isClosed).toBe(true);
    });

    it('leaves a trainer_id operator object (no_trainer => { $size: 0 }) untouched', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({
        filter: { trainer_id: { $size: 0 } },
        query: {}
      });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match.trainer_id).toEqual({ $size: 0 });
    });

    it('omits the isDuplicate/surveySubmitted filters when not provided', async () => {
      Interview.aggregate.mockReturnValue(aggChain([{ rows: [], total: [] }]));

      await InterviewDAO.getInterviewsPaginated({ query: {} });

      const pipeline = Interview.aggregate.mock.calls[0][0];
      // No post-match $and stage when there are no filters/search.
      expect(pipeline.filter((s) => s.$match && s.$match.$and)).toHaveLength(0);
      // Default sort is interview_date desc.
      const facetStage = pipeline.find((s) => s.$facet);
      expect(facetStage.$facet.rows[0]).toEqual({
        $sort: { interview_date: -1, _id: 1 }
      });
    });
  });
});
