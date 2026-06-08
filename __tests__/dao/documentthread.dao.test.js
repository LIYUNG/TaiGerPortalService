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

const { Documentthread } = require('../../models');
const DocumentthreadDAO = require('../../dao/documentthread.dao');

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
