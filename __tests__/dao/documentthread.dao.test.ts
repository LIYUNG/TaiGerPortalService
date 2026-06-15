// DocumentthreadDAO unit tests — the DAO is a thin query-building layer over the
// Documentthread Mongoose model, so we mock the model entirely (NO database,
// in-memory or otherwise). These assert that each DAO method builds the
// expected query/options and forwards the model's result, plus the pure
// query-parse/condition helpers (tested directly). The heavy aggregation
// pipelines (findActiveThreadsPaginated / countActiveThreads) are validated for
// wiring + result shape only — pipeline internals are covered by the
// integration suite (__tests__/integration), which runs against in-memory Mongo.
jest.mock('../../models', () => {
  // Documentthread is used both as a constructor (new Documentthread(payload))
  // and as a holder of static query methods, so model it as a jest.fn() with
  // statics attached.
  const Documentthread = jest.fn(function (payload) {
    Object.assign(this, payload);
  });
  Object.assign(Documentthread, {
    countDocuments: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    updateOne: jest.fn(),
    aggregate: jest.fn()
  });
  return { Documentthread };
});

// createApplicationThread delegates to the version-control helper; mock it so we
// assert the delegation without pulling in the real model wiring.
jest.mock('../../utils/modelHelper/versionControl', () => ({
  createApplicationThreadV2: jest.fn()
}));

import { Documentthread } from '../../models';
import { createApplicationThreadV2 } from '../../utils/modelHelper/versionControl';
import DocumentthreadDAO from '../../dao/documentthread.dao';

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

// A query chain that is itself thenable (no terminal `.lean()`): awaiting it
// resolves to `value`, while builder calls return the same chain.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

// Aggregations are called as `Documentthread.aggregate(pipeline).allowDiskUse(true)`.
const aggDiskChain = (value) => ({
  allowDiskUse: jest.fn().mockResolvedValue(value)
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocumentthreadDAO simple CRUD/read (mocked models)', () => {
  it('newThread constructs an unsaved Documentthread from the payload', () => {
    const payload = { file_type: 'Essay', student_id: 's1' };

    const thread = DocumentthreadDAO.newThread(payload);

    expect(Documentthread).toHaveBeenCalledWith(payload);
    expect(thread).toBeInstanceOf(Documentthread);
    expect(thread.file_type).toBe('Essay');
  });

  it('countThreads forwards the filter to countDocuments', async () => {
    Documentthread.countDocuments.mockResolvedValue(7);

    const result = await DocumentthreadDAO.countThreads({ file_type: 'Essay' });

    expect(Documentthread.countDocuments).toHaveBeenCalledWith({
      file_type: 'Essay'
    });
    expect(result).toBe(7);
  });

  it('createApplicationThread delegates to createApplicationThreadV2', async () => {
    const created = { _id: 't0' };
    createApplicationThreadV2.mockResolvedValue(created);

    const result = await DocumentthreadDAO.createApplicationThread(
      's1',
      'a1',
      'CV'
    );

    expect(createApplicationThreadV2).toHaveBeenCalledWith('s1', 'a1', 'CV');
    expect(result).toBe(created);
  });

  it('createThread forwards the payload to create', async () => {
    const created = { _id: 't1' };
    Documentthread.create.mockResolvedValue(created);

    const result = await DocumentthreadDAO.createThread({ file_type: 'CV' });

    expect(Documentthread.create).toHaveBeenCalledWith({ file_type: 'CV' });
    expect(result).toBe(created);
  });

  it('deleteThreadById forwards the id to findByIdAndDelete', async () => {
    const deleted = { _id: 't2' };
    Documentthread.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await DocumentthreadDAO.deleteThreadById('t2');

    expect(Documentthread.findByIdAndDelete).toHaveBeenCalledWith('t2');
    expect(result).toBe(deleted);
  });

  it('updateThreadFields uses findByIdAndUpdate with empty options', async () => {
    const pre = { _id: 't3' };
    Documentthread.findByIdAndUpdate.mockResolvedValue(pre);

    const result = await DocumentthreadDAO.updateThreadFields('t3', {
      isFinalVersion: true
    });

    expect(Documentthread.findByIdAndUpdate).toHaveBeenCalledWith(
      't3',
      { isFinalVersion: true },
      {}
    );
    expect(result).toBe(pre);
  });

  it('getThreadByIdLean looks up by id and returns the lean doc', async () => {
    const doc = { _id: 't4' };
    Documentthread.findById.mockReturnValue(leanChain(doc));

    const result = await DocumentthreadDAO.getThreadByIdLean('t4');

    expect(Documentthread.findById).toHaveBeenCalledWith('t4');
    expect(result).toBe(doc);
  });

  it('findThreads forwards filter + select and returns lean docs', async () => {
    const docs = [{ _id: 't5' }];
    const chain = leanChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const result = await DocumentthreadDAO.findThreads(
      { file_type: 'Essay' },
      'file_type isFinalVersion'
    );

    expect(Documentthread.find).toHaveBeenCalledWith({ file_type: 'Essay' });
    expect(chain.select).toHaveBeenCalledWith('file_type isFinalVersion');
    expect(result).toBe(docs);
  });

  it('findThreadsSelectSorted forwards filter + select + sort (lean)', async () => {
    const docs = [{ _id: 't6' }];
    const chain = leanChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const result = await DocumentthreadDAO.findThreadsSelectSorted(
      { file_type: 'Essay' },
      'file_type',
      { updatedAt: -1 }
    );

    expect(Documentthread.find).toHaveBeenCalledWith({ file_type: 'Essay' });
    expect(chain.select).toHaveBeenCalledWith('file_type');
    expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(result).toBe(docs);
  });

  it('getThreadDocById returns the live (non-lean) document', async () => {
    const live = { _id: 't7', save: jest.fn() };
    Documentthread.findById.mockReturnValue(live);

    const result = await DocumentthreadDAO.getThreadDocById('t7');

    expect(Documentthread.findById).toHaveBeenCalledWith('t7');
    expect(result).toBe(live);
  });

  it('getThreadDocByIdPopulated applies populates and returns the live query', async () => {
    const live = { _id: 't8' };
    const chain = queryChain(live);
    Documentthread.findById.mockReturnValue(chain);

    const result = await DocumentthreadDAO.getThreadDocByIdPopulated('t8', [
      ['program_id'],
      ['messages.user_id', 'firstname lastname']
    ]);

    expect(Documentthread.findById).toHaveBeenCalledWith('t8');
    expect(chain.populate).toHaveBeenNthCalledWith(1, 'program_id');
    expect(chain.populate).toHaveBeenNthCalledWith(
      2,
      'messages.user_id',
      'firstname lastname'
    );
    // No .lean() — the DAO returns the live query; awaiting it executes.
    expect(result).toBe(live);
  });

  it('findThreadByIdPopulated applies populates and returns the lean doc', async () => {
    const doc = { _id: 't9' };
    const chain = leanChain(doc);
    Documentthread.findById.mockReturnValue(chain);

    const result = await DocumentthreadDAO.findThreadByIdPopulated('t9', [
      ['program_id']
    ]);

    expect(Documentthread.findById).toHaveBeenCalledWith('t9');
    expect(chain.populate).toHaveBeenCalledWith('program_id');
    expect(result).toBe(doc);
  });

  it('findOneThreadPopulated applies populates to findOne and returns lean doc', async () => {
    const doc = { _id: 't10' };
    const chain = leanChain(doc);
    Documentthread.findOne.mockReturnValue(chain);

    const filter = { _id: 't10' };
    const result = await DocumentthreadDAO.findOneThreadPopulated(filter, [
      ['program_id']
    ]);

    expect(Documentthread.findOne).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith('program_id');
    expect(result).toBe(doc);
  });

  it('findOneThreadDoc forwards the filter to findOne (live doc)', async () => {
    const live = { _id: 't11', save: jest.fn() };
    Documentthread.findOne.mockResolvedValue(live);

    const filter = { application_id: 'a1', file_type: 'Essay' };
    const result = await DocumentthreadDAO.findOneThreadDoc(filter);

    expect(Documentthread.findOne).toHaveBeenCalledWith(filter);
    expect(result).toBe(live);
  });

  it('clearAllOutsourcedUsers issues the bulk reset updateMany', async () => {
    const res = { modifiedCount: 3 };
    Documentthread.updateMany.mockResolvedValue(res);

    const result = await DocumentthreadDAO.clearAllOutsourcedUsers();

    expect(Documentthread.updateMany).toHaveBeenCalledWith(
      { outsourced_user_id: { $exists: true } },
      { $set: { outsourced_user_id: [] } }
    );
    expect(result).toBe(res);
  });

  it('setMessageIgnore updates the positional message ignore flag', async () => {
    const res = { modifiedCount: 1 };
    Documentthread.updateOne.mockResolvedValue(res);

    const result = await DocumentthreadDAO.setMessageIgnore('m1', true);

    expect(Documentthread.updateOne).toHaveBeenCalledWith(
      { 'messages._id': 'm1' },
      { $set: { 'messages.$.ignore_message': true } }
    );
    expect(result).toBe(res);
  });

  it('findThreadByIdFullyPopulated populates author/program/outsourced (lean)', async () => {
    const doc = { _id: 't12' };
    const chain = leanChain(doc);
    Documentthread.findById.mockReturnValue(chain);

    const result = await DocumentthreadDAO.findThreadByIdFullyPopulated('t12');

    expect(Documentthread.findById).toHaveBeenCalledWith('t12');
    expect(chain.populate).toHaveBeenCalledWith('program_id');
    expect(chain.populate).toHaveBeenCalledTimes(4);
    expect(result).toBe(doc);
  });

  it('findThreadsByStudentIdPopulated queries by student_id and returns lean docs', async () => {
    const docs = [{ _id: 't13' }];
    const chain = leanChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const result = await DocumentthreadDAO.findThreadsByStudentIdPopulated(
      's1'
    );

    expect(Documentthread.find).toHaveBeenCalledWith({ student_id: 's1' });
    expect(chain.populate).toHaveBeenCalledWith('application_id');
    expect(result).toBe(docs);
  });

  it('findThreadsForTaiGerUserPopulated forwards the filter and returns lean docs', async () => {
    const docs = [{ _id: 't14' }];
    const chain = leanChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const filter = { student_id: { $in: ['s1'] } };
    const result = await DocumentthreadDAO.findThreadsForTaiGerUserPopulated(
      filter
    );

    expect(Documentthread.find).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith('application_id');
    expect(result).toBe(docs);
  });

  it('findAllStudentsThreadsPopulated forwards the filter and returns lean docs', async () => {
    const docs = [{ _id: 't15' }];
    const chain = leanChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const filter = { file_type: 'Essay' };
    const result = await DocumentthreadDAO.findAllStudentsThreadsPopulated(
      filter
    );

    expect(Documentthread.find).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith('application_id');
    expect(result).toBe(docs);
  });

  it('findThreadsPopulated forwards the filter and returns lean docs', async () => {
    const docs = [{ _id: 't16' }];
    const chain = leanChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const filter = { student_id: 's1' };
    const result = await DocumentthreadDAO.findThreadsPopulated(filter);

    expect(Documentthread.find).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith('program_id');
    expect(chain.populate).toHaveBeenCalledWith('application_id');
    expect(result).toBe(docs);
  });

  it('updateThreadByIdReturnNew uses findByIdAndUpdate({ new: true }).lean()', async () => {
    const updated = { _id: 't17' };
    const chain = leanChain(updated);
    Documentthread.findByIdAndUpdate.mockReturnValue(chain);

    const result = await DocumentthreadDAO.updateThreadByIdReturnNew('t17', {
      isFinalVersion: true
    });

    expect(Documentthread.findByIdAndUpdate).toHaveBeenCalledWith(
      't17',
      { isFinalVersion: true },
      { new: true }
    );
    expect(result).toBe(updated);
  });

  it('updateOneThreadReturnNew uses findOneAndUpdate({ new: true }).lean()', async () => {
    const updated = { _id: 't18' };
    const chain = leanChain(updated);
    Documentthread.findOneAndUpdate.mockReturnValue(chain);

    const filter = { _id: 't18' };
    const result = await DocumentthreadDAO.updateOneThreadReturnNew(filter, {
      isFinalVersion: false
    });

    expect(Documentthread.findOneAndUpdate).toHaveBeenCalledWith(
      filter,
      { isFinalVersion: false },
      { new: true }
    );
    expect(result).toBe(updated);
  });
});

describe('DocumentthreadDAO.findActiveThreadsPaginated (mocked models)', () => {
  it('returns the empty page without touching aggregate when studentIds is empty', async () => {
    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [],
      query: { page: 2, limit: 30 }
    });

    expect(res).toEqual({ threads: [], total: 0, page: 2, limit: 30 });
    expect(Documentthread.aggregate).not.toHaveBeenCalled();
  });

  it('runs the aggregation and returns the rows + total from the facet', async () => {
    const rows = [{ thread_id: 'tA' }, { thread_id: 'tB' }];
    Documentthread.aggregate.mockReturnValue(
      aggDiskChain([{ rows, total: [{ count: 12 }] }])
    );

    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: { page: 1, limit: 20 }
    });

    expect(Documentthread.aggregate).toHaveBeenCalledTimes(1);
    expect(res.threads).toBe(rows);
    expect(res.total).toBe(12);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });

  it('short-circuits on empty studentIds even when an outsourcedUserId is set', async () => {
    // Unlike countActiveThreads, findActiveThreadsPaginated keys the empty
    // short-circuit purely on studentIds.length, so it never hits aggregate.
    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [],
      outsourcedUserId: '64b000000000000000000002',
      query: {}
    });

    expect(Documentthread.aggregate).not.toHaveBeenCalled();
    expect(res.threads).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('defaults to an empty page/total when the facet is empty', async () => {
    Documentthread.aggregate.mockReturnValue(
      aggDiskChain([{ rows: [], total: [] }])
    );

    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: {}
    });

    expect(res.threads).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });
});

describe('DocumentthreadDAO.countActiveThreads (mocked models)', () => {
  const zero = {
    all: 0,
    closed: 0,
    in_progress: 0,
    no_input: 0,
    no_writer: 0,
    new_message: 0,
    fav: 0,
    followup: 0,
    pending_progress: 0
  };

  it('returns all-zero counts without touching aggregate when empty', async () => {
    const res = await DocumentthreadDAO.countActiveThreads({
      studentIds: [],
      outsourcedUserId: null,
      query: {}
    });

    expect(res).toEqual(zero);
    expect(Documentthread.aggregate).not.toHaveBeenCalled();
  });

  it('merges the aggregation counts over the zero baseline', async () => {
    Documentthread.aggregate.mockReturnValue(
      aggDiskChain([{ all: 5, closed: 2, in_progress: 3 }])
    );

    const res = await DocumentthreadDAO.countActiveThreads({
      studentIds: ['64b000000000000000000001'],
      query: { viewerId: '64b000000000000000000003' }
    });

    expect(Documentthread.aggregate).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      ...zero,
      all: 5,
      closed: 2,
      in_progress: 3
    });
  });

  it('runs the aggregation for an outsourced-only viewer (no studentIds)', async () => {
    // countActiveThreads only short-circuits when BOTH studentIds is empty AND
    // there is no outsourcedUserId — so the outsourced-only case hits aggregate.
    Documentthread.aggregate.mockReturnValue(aggDiskChain([{ all: 4 }]));

    const res = await DocumentthreadDAO.countActiveThreads({
      studentIds: [],
      outsourcedUserId: '64b000000000000000000002',
      query: {}
    });

    expect(Documentthread.aggregate).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ...zero, all: 4 });
  });

  it('returns the zero baseline when the aggregation yields no group', async () => {
    Documentthread.aggregate.mockReturnValue(aggDiskChain([]));

    const res = await DocumentthreadDAO.countActiveThreads({
      studentIds: ['64b000000000000000000001'],
      query: {}
    });

    expect(res).toEqual(zero);
  });
});

// ---- Pure helpers exercised through the public DAO surface ----
// buildFileTypeCond / parseArrayParam / buildCategoryMatch / parseActiveThreadsQuery
// are module-private. Their observable effects are asserted via the aggregation
// short-circuits and result shapes above; below we additionally pin down the
// page/limit parsing behaviour (parseActiveThreadsQuery) through the empty
// short-circuit, which is the deterministic, mock-free path.
describe('DocumentthreadDAO query parsing (pure, via empty short-circuit)', () => {
  it('applies default page (1) and limit (20)', async () => {
    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [],
      query: {}
    });
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });

  it('clamps an oversized limit to MAX (100)', async () => {
    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [],
      query: { limit: '9999' }
    });
    expect(res.limit).toBe(100);
  });

  it('falls back to defaults for non-positive / non-numeric page & limit', async () => {
    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [],
      query: { page: '-3', limit: 'abc' }
    });
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });

  it('honours a valid page & limit', async () => {
    const res = await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [],
      query: { page: '5', limit: '15' }
    });
    expect(res.page).toBe(5);
    expect(res.limit).toBe(15);
  });
});

// ---- Pipeline-branch coverage: drive the module-private helpers
// (buildFileTypeCond / parseArrayParam / buildCategoryMatch / escapeRegex /
// THREAD_SORT_FIELD_MAP) through the two aggregation entry points and inspect
// the pipeline passed to Documentthread.aggregate. Pipeline *internals* are
// validated by the integration suite; here we only assert the conditional
// stages/$match conditions the DAO assembles from the query/scope.
describe('DocumentthreadDAO.findActiveThreadsPaginated pipeline assembly', () => {
  const STUDENT = '64b000000000000000000001';

  // Returns the preMatch ($match on the thread) and the post-computed-fields
  // $match (the one carrying $and with student.archiv).
  const runAndGetPipeline = async (extra) => {
    Documentthread.aggregate.mockReturnValue(
      aggDiskChain([{ rows: [], total: [] }])
    );
    await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [STUDENT],
      query: { page: 1, limit: 20, ...extra?.query },
      ...extra
    });
    return Documentthread.aggregate.mock.calls[0][0];
  };

  it('defaults file_type to {$ne: "Interview"} and scopes by student_id', async () => {
    const pipeline = await runAndGetPipeline();
    const preMatch = pipeline[0].$match;
    expect(preMatch.file_type).toEqual({ $ne: 'Interview' });
    expect(preMatch.student_id.$in).toHaveLength(1);
  });

  it('uses a single file_type value when one is given', async () => {
    const pipeline = await runAndGetPipeline({
      query: { file_type: 'Essay' }
    });
    expect(pipeline[0].$match.file_type).toBe('Essay');
  });

  it('uses $in when a comma-separated file_type list is given', async () => {
    const pipeline = await runAndGetPipeline({
      query: { file_type: 'CV,ML,RL_A' }
    });
    expect(pipeline[0].$match.file_type).toEqual({ $in: ['CV', 'ML', 'RL_A'] });
  });

  it('builds the outsourced-user scope $or (instead of student_id) when set', async () => {
    const pipeline = await runAndGetPipeline({
      outsourcedUserId: '64b000000000000000000002'
    });
    const preMatch = pipeline[0].$match;
    // student_id moves into the $and -> $or scope, not the top-level match.
    expect(preMatch.student_id).toBeUndefined();
    expect(preMatch.$and[0].$or[0].student_id.$in).toHaveLength(1);
    expect(preMatch.$and[0].$or[1].file_type).toBe('Essay');
  });

  it('adds an excludeFileType $nin (with viewer override) scope condition', async () => {
    const pipeline = await runAndGetPipeline({
      query: {
        excludeFileType: 'Supplementary_Form,Supplementary_Material',
        viewerId: '64b000000000000000000003'
      }
    });
    const scope = pipeline[0].$match.$and;
    const orCond = scope.find((c) => c.$or);
    expect(orCond.$or[0].file_type.$nin).toEqual([
      'Supplementary_Form',
      'Supplementary_Material'
    ]);
    // viewer override: outsourced collaborators still see the excluded type.
    expect(orCond.$or[1].outsourced_user_id).toBeDefined();
  });

  it('accepts an already-array excludeFileType param', async () => {
    const pipeline = await runAndGetPipeline({
      query: {
        excludeFileType: ['Supplementary_Form', 'Supplementary_Material']
      }
    });
    const scope = pipeline[0].$match.$and;
    const orCond = scope.find((c) => c.$or);
    expect(orCond.$or[0].file_type.$nin).toEqual([
      'Supplementary_Form',
      'Supplementary_Material'
    ]);
  });

  it('pre-matches isFinalVersion=true for the "closed" category', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'closed' }
    });
    expect(pipeline[0].$match.isFinalVersion).toBe(true);
  });

  it('pre-matches isFinalVersion={$ne:true} for non-closed, non-all categories', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'in_progress' }
    });
    expect(pipeline[0].$match.isFinalVersion).toEqual({ $ne: true });
  });

  it('appends a buildCategoryMatch stage for a computed category (no_writer)', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'no_writer' }
    });
    const hasNoWriter = pipeline.some(
      (s) => s.$match && s.$match._noWriter === true
    );
    expect(hasNoWriter).toBe(true);
  });

  it('appends a closed category match (_isFinal: true)', async () => {
    const pipeline = await runAndGetPipeline({ query: { category: 'closed' } });
    expect(pipeline.some((s) => s.$match && s.$match._isFinal === true)).toBe(
      true
    );
  });

  it('appends an in_progress category match (_hasMessages: true)', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'in_progress' }
    });
    expect(
      pipeline.some(
        (s) =>
          s.$match &&
          s.$match._isFinal === false &&
          s.$match._hasMessages === true
      )
    ).toBe(true);
  });

  it('appends a no_input category match (_hasMessages: false)', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'no_input' }
    });
    expect(
      pipeline.some(
        (s) =>
          s.$match &&
          s.$match._isFinal === false &&
          s.$match._hasMessages === false
      )
    ).toBe(true);
  });

  it('appends a fav category match (_favForViewer: true)', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'fav', viewerId: '64b000000000000000000003' }
    });
    expect(
      pipeline.some((s) => s.$match && s.$match._favForViewer === true)
    ).toBe(true);
  });

  it('appends a new_message category match ($nin on _latestById)', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'new_message', viewerId: '64b000000000000000000003' }
    });
    expect(
      pipeline.some(
        (s) => s.$match && s.$match._latestById && s.$match._latestById.$nin
      )
    ).toBe(true);
  });

  it('appends a pending_progress category match (_hasMessages: false)', async () => {
    const pipeline = await runAndGetPipeline({
      query: { category: 'pending_progress' }
    });
    expect(
      pipeline.some(
        (s) =>
          s.$match &&
          s.$match._isFinal === false &&
          s.$match._hasMessages === false
      )
    ).toBe(true);
  });

  it('appends a viewer-dependent followup category match', async () => {
    const viewerId = '64b000000000000000000003';
    const pipeline = await runAndGetPipeline({
      query: { category: 'followup', viewerId }
    });
    const followup = pipeline.find(
      (s) => s.$match && s.$match._latestById === viewerId
    );
    expect(followup).toBeDefined();
  });

  it('adds column filters (name/document_name/lang/deadline/status) + search to the post $and', async () => {
    const pipeline = await runAndGetPipeline({
      query: {
        name: 'Ja.ne',
        document_name: 'CV',
        lang: 'English',
        deadline: '2025/09',
        status: 'Locked',
        search: 'a*b'
      }
    });
    // The post-lookup $and match always starts with student.archiv filter.
    const andMatch = pipeline.find(
      (s) =>
        s.$match &&
        Array.isArray(s.$match.$and) &&
        s.$match.$and.some((c) => c['student.archiv'])
    ).$match.$and;
    const flat = JSON.stringify(andMatch);
    expect(flat).toContain('student.firstname');
    expect(flat).toContain('document_name');
    expect(flat).toContain('lang');
    expect(flat).toContain('deadline');
    // status Locked -> isLocked true
    expect(andMatch.some((c) => c.isLocked === true)).toBe(true);
    // search metacharacters escaped (a\\*b)
    expect(flat).toContain('a\\\\*b');
  });

  it('adds editor / agent / essay-writer name filters on the joined collaborators', async () => {
    const pipeline = await runAndGetPipeline({
      query: {
        editorName: 'Al.ice',
        agentName: 'Bob',
        essayWriterName: 'Eve'
      }
    });
    const andMatch = pipeline.find(
      (s) =>
        s.$match &&
        Array.isArray(s.$match.$and) &&
        s.$match.$and.some((c) => c['student.archiv'])
    ).$match.$and;

    const editor = andMatch.find((c) => c['editors.firstname']);
    expect(editor['editors.firstname']).toEqual({
      $regex: 'Al\\.ice', // metacharacters escaped
      $options: 'i'
    });
    expect(andMatch.some((c) => c['agents.firstname']?.$regex === 'Bob')).toBe(
      true
    );
    expect(
      andMatch.some((c) => c['outsourced_user_id.firstname']?.$regex === 'Eve')
    ).toBe(true);
  });

  it('maps an Unlocked status filter to isLocked=false', async () => {
    const pipeline = await runAndGetPipeline({
      query: { status: 'Unlocked' }
    });
    const andMatch = pipeline.find(
      (s) =>
        s.$match &&
        Array.isArray(s.$match.$and) &&
        s.$match.$and.some((c) => c['student.archiv'])
    ).$match.$and;
    expect(andMatch.some((c) => c.isLocked === false)).toBe(true);
  });

  it('honours the document_name sort field map', async () => {
    Documentthread.aggregate.mockReturnValue(
      aggDiskChain([{ rows: [], total: [] }])
    );
    await DocumentthreadDAO.findActiveThreadsPaginated({
      studentIds: [STUDENT],
      query: { sortBy: 'document_name', sortOrder: 'desc' }
    });
    const pipeline = Documentthread.aggregate.mock.calls[0][0];
    const facet = pipeline.find((s) => s.$facet).$facet;
    expect(facet.rows[0].$sort).toEqual({ document_name: -1, _id: 1 });
  });
});

describe('DocumentthreadDAO.countActiveThreads pipeline assembly', () => {
  const STUDENT = '64b000000000000000000001';

  it('defaults file_type and scopes by student_id', async () => {
    Documentthread.aggregate.mockReturnValue(aggDiskChain([{ all: 0 }]));
    await DocumentthreadDAO.countActiveThreads({
      studentIds: [STUDENT],
      query: {}
    });
    const preMatch = Documentthread.aggregate.mock.calls[0][0][0].$match;
    expect(preMatch.file_type).toEqual({ $ne: 'Interview' });
    expect(preMatch.student_id.$in).toHaveLength(1);
  });

  it('builds the outsourced scope $or when outsourcedUserId is set', async () => {
    Documentthread.aggregate.mockReturnValue(aggDiskChain([{ all: 0 }]));
    await DocumentthreadDAO.countActiveThreads({
      studentIds: [STUDENT],
      outsourcedUserId: '64b000000000000000000002',
      query: { file_type: 'Essay' }
    });
    const preMatch = Documentthread.aggregate.mock.calls[0][0][0].$match;
    expect(preMatch.student_id).toBeUndefined();
    expect(preMatch.$and[0].$or[1].file_type).toBe('Essay');
  });

  it('adds the excludeFileType $nin scope (with viewer override)', async () => {
    Documentthread.aggregate.mockReturnValue(aggDiskChain([{ all: 0 }]));
    await DocumentthreadDAO.countActiveThreads({
      studentIds: [STUDENT],
      query: {
        excludeFileType: 'Supplementary_Form',
        viewerId: '64b000000000000000000003'
      }
    });
    const scope = Documentthread.aggregate.mock.calls[0][0][0].$match.$and;
    const orCond = scope.find((c) => c.$or);
    expect(orCond.$or[0].file_type.$nin).toEqual(['Supplementary_Form']);
    expect(orCond.$or[1].outsourced_user_id).toBeDefined();
  });
});
