// StudentDAO unit tests — the DAO is a thin query-building layer over the
// Student/User Mongoose models, so we mock the models entirely (NO database,
// in-memory or otherwise). These assert that each DAO method builds the
// expected query/options and forwards the model's result. Real
// query/aggregation behaviour is covered by the integration suite
// (__tests__/integration), which runs against in-memory MongoDB.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    aggregate: jest.fn()
  });
  return {
    Student: model(),
    User: model()
  };
});

import { Student as StudentModel, User as UserModel } from '../../models';
import StudentDAO from '../../dao/student.dao';

// The models are auto-mocked above (every method is a jest.fn()); retype
// them so the mock API (mockReturnValue/…) is visible to the type-checker.
const Student = StudentModel as unknown as Record<string, jest.Mock>;
const User = UserModel as unknown as Record<string, jest.Mock>;

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls return the same chain so they compose.
const leanChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    countDocuments: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

// A query chain that is itself thenable (no terminal `.lean()`): awaiting it
// resolves to `value`, while builder calls return the same chain.
const queryChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    then: (resolve: any, reject: any) =>
      Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

// `.lean()` returns a thenable query that also exposes `.limit()` — used by
// findStudentsSelect, which calls `.limit()` AFTER `.lean()` and then awaits.
const leanLimitChain = (value: unknown) => {
  const leanQuery: any = {
    limit: jest.fn(),
    then: (resolve: any, reject: any) =>
      Promise.resolve(value).then(resolve, reject)
  };
  const chain: any = {
    select: jest.fn(() => chain),
    lean: jest.fn(() => leanQuery)
  };
  return { chain, leanQuery };
};

// `Student.find(filter).countDocuments()` — find() returns a chain whose
// countDocuments() resolves to the count.
const countChain = (value: unknown) => ({
  countDocuments: jest.fn().mockResolvedValue(value)
});

// Aggregations are called as `Student.aggregate(pipeline).allowDiskUse(true)`
// for the paginated read, or awaited directly for the simple aggregates.
const aggDiskChain = (value: unknown) => ({
  allowDiskUse: jest.fn().mockResolvedValue(value)
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('StudentDAO.parseStudentsQuery (pure, via getStudentsPaginated)', () => {
  // parseStudentsQuery is not exported; exercise its defaults/clamping through
  // the empty-page short-circuit of getStudentsPaginated (no model hydrate).
  it('applies default page/limit and returns the empty page shape', async () => {
    Student.aggregate.mockReturnValue(aggDiskChain([{ rows: [], total: [] }]));

    const res = await StudentDAO.getStudentsPaginated({
      filter: {},
      query: {}
    });

    expect(res).toEqual({ students: [], total: 0, page: 1, limit: 20 });
    expect(Student.find).not.toHaveBeenCalled();
  });

  it('clamps an oversized limit to the MAX (100)', async () => {
    Student.aggregate.mockReturnValue(aggDiskChain([{ rows: [], total: [] }]));

    const res = await StudentDAO.getStudentsPaginated({
      filter: {},
      query: { limit: '5000' }
    });

    expect(res.limit).toBe(100);
  });

  it('uses the requested page when valid', async () => {
    Student.aggregate.mockReturnValue(aggDiskChain([{ rows: [], total: [] }]));

    const res = await StudentDAO.getStudentsPaginated({
      filter: {},
      query: { page: '4', limit: '10' }
    });

    expect(res.page).toBe(4);
    expect(res.limit).toBe(10);
  });
});

describe('StudentDAO simple reads (mocked models)', () => {
  it('fetchStudents forwards the filter + options and returns the lean docs', async () => {
    const docs = [{ _id: 's1' }];
    Student.find.mockReturnValue(leanChain(docs));

    const result = await StudentDAO.fetchStudents(
      { archiv: false },
      { sort: { nameEn: 1 }, skip: 0, limit: 10 }
    );

    expect(Student.find).toHaveBeenCalledWith({ archiv: false });
    expect(result).toBe(docs);
  });

  it('fetchSimpleStudents forwards the filter and returns lean docs', async () => {
    const docs = [{ _id: 's2' }];
    Student.find.mockReturnValue(leanChain(docs));

    const result = await StudentDAO.fetchSimpleStudents({ role: 'Student' });

    expect(Student.find).toHaveBeenCalledWith({ role: 'Student' });
    expect(result).toBe(docs);
  });

  it('fetchStudentIds selects only _id (no populate) and returns lean docs', async () => {
    const docs = [{ _id: 's2' }];
    const chain = leanChain(docs);
    Student.find.mockReturnValue(chain);

    const result = await StudentDAO.fetchStudentIds({ archiv: false });

    expect(Student.find).toHaveBeenCalledWith({ archiv: false });
    expect(chain.select).toHaveBeenCalledWith('_id');
    expect(chain.populate).not.toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  it('getStudents queries User (not Student) and returns lean docs', async () => {
    const docs = [{ _id: 'u1' }];
    User.find.mockReturnValue(leanChain(docs));

    const result = await StudentDAO.getStudents({
      filter: { role: 'Student' },
      options: { sort: { x: 1 }, skip: 0, limit: 5 }
    });

    expect(User.find).toHaveBeenCalledWith({ role: 'Student' });
    expect(result).toBe(docs);
  });

  it('getStudentById looks up by id and returns the lean doc', async () => {
    const doc = { _id: 's3' };
    Student.findById.mockReturnValue(leanChain(doc));

    const result = await StudentDAO.getStudentById('s3');

    expect(Student.findById).toHaveBeenCalledWith('s3');
    expect(result).toBe(doc);
  });

  it('getStudentByIdLean looks up by id (bare, no populate)', async () => {
    const doc = { _id: 's4' };
    Student.findById.mockReturnValue(leanChain(doc));

    const result = await StudentDAO.getStudentByIdLean('s4');

    expect(Student.findById).toHaveBeenCalledWith('s4');
    expect(result).toBe(doc);
  });

  it('getStudentDocById returns the live (non-lean) document', async () => {
    const live = { _id: 's5', save: jest.fn() };
    Student.findById.mockReturnValue(live);

    const result = await StudentDAO.getStudentDocById('s5');

    expect(Student.findById).toHaveBeenCalledWith('s5');
    expect(result).toBe(live);
  });

  it('getStudentByIdPopulated applies each populate tuple and returns lean doc', async () => {
    const doc = { _id: 's6' };
    const chain = leanChain(doc);
    Student.findById.mockReturnValue(chain);

    const populates = [
      ['agents editors', 'firstname lastname email'],
      ['applications.programId']
    ];
    const result = await StudentDAO.getStudentByIdPopulated('s6', populates);

    expect(Student.findById).toHaveBeenCalledWith('s6');
    expect(chain.populate).toHaveBeenCalledTimes(2);
    expect(chain.populate).toHaveBeenNthCalledWith(
      1,
      'agents editors',
      'firstname lastname email'
    );
    expect(chain.populate).toHaveBeenNthCalledWith(2, 'applications.programId');
    expect(result).toBe(doc);
  });

  it('getStudentDocByIdPopulated applies populates and returns the live doc', async () => {
    const live = { _id: 's7', save: jest.fn() };
    const chain = queryChain(live);
    Student.findById.mockReturnValue(chain);

    // No .lean() — the DAO returns the live query; awaiting it executes.
    const result = await StudentDAO.getStudentDocByIdPopulated('s7', [
      ['agents editors']
    ]);

    expect(Student.findById).toHaveBeenCalledWith('s7');
    expect(chain.populate).toHaveBeenCalledWith('agents editors');
    expect(result).toBe(live);
  });

  it('updateStudentByFilter uses findOneAndUpdate with { new: true }', async () => {
    const updated = { _id: 's8' };
    Student.findOneAndUpdate.mockResolvedValue(updated);

    const filter = { _id: 's8', 'applications._id': 'a1' };
    const update = { $set: { 'applications.$.decided': 'O' } };
    const result = await StudentDAO.updateStudentByFilter(filter, update);

    expect(Student.findOneAndUpdate).toHaveBeenCalledWith(filter, update, {
      new: true
    });
    expect(result).toBe(updated);
  });

  it('updateStudentByIdRaw uses findByIdAndUpdate with empty options', async () => {
    const res = { acknowledged: true };
    Student.findByIdAndUpdate.mockResolvedValue(res);

    const result = await StudentDAO.updateStudentByIdRaw('s9', {
      archiv: true
    });

    expect(Student.findByIdAndUpdate).toHaveBeenCalledWith(
      's9',
      { archiv: true },
      {}
    );
    expect(result).toBe(res);
  });

  it('findStudents runs a bare find().lean()', async () => {
    const docs = [{ _id: 's10' }];
    Student.find.mockReturnValue(leanChain(docs));

    const result = await StudentDAO.findStudents({ archiv: true });

    expect(Student.find).toHaveBeenCalledWith({ archiv: true });
    expect(result).toBe(docs);
  });

  it('findStudents defaults to an empty filter', async () => {
    Student.find.mockReturnValue(leanChain([]));

    await StudentDAO.findStudents();

    expect(Student.find).toHaveBeenCalledWith({});
  });

  it('findStudentsWithTeamNames populates team names and returns lean docs', async () => {
    const docs = [{ _id: 's11' }];
    const chain = leanChain(docs);
    Student.find.mockReturnValue(chain);

    const result = await StudentDAO.findStudentsWithTeamNames({ archiv: true });

    expect(Student.find).toHaveBeenCalledWith({ archiv: true });
    expect(chain.populate).toHaveBeenCalledWith(
      'agents editors',
      'firstname lastname'
    );
    expect(result).toBe(docs);
  });

  it('countStudents runs find(filter).countDocuments()', async () => {
    Student.find.mockReturnValue(countChain(42));

    const result = await StudentDAO.countStudents({ role: 'Student' });

    expect(Student.find).toHaveBeenCalledWith({ role: 'Student' });
    expect(result).toBe(42);
  });

  it('getStudentApplicationsForIntervals selects projected app fields (lean)', async () => {
    const doc = { _id: 's12', applications: [] };
    const chain = leanChain(doc);
    Student.findById.mockReturnValue(chain);

    const result = await StudentDAO.getStudentApplicationsForIntervals('s12');

    expect(Student.findById).toHaveBeenCalledWith('s12');
    expect(chain.populate).toHaveBeenCalledWith({
      path: 'applications.programId',
      select: 'school program_name'
    });
    expect(result).toBe(doc);
  });

  it('getStudentByIdSelect applies the select and returns lean doc', async () => {
    const doc = { _id: 's13' };
    const chain = leanChain(doc);
    Student.findById.mockReturnValue(chain);

    const result = await StudentDAO.getStudentByIdSelect('s13', 'firstname');

    expect(Student.findById).toHaveBeenCalledWith('s13');
    expect(chain.select).toHaveBeenCalledWith('firstname');
    expect(result).toBe(doc);
  });

  it('getStudentByIdSelectPopulated returns a live select+populate query', async () => {
    const live = { _id: 's14' };
    const chain = queryChain(live);
    Student.findById.mockReturnValue(chain);

    // No .lean() — the DAO returns the live query; awaiting it executes.
    const result = await StudentDAO.getStudentByIdSelectPopulated(
      's14',
      'firstname',
      'agents',
      'firstname lastname'
    );

    expect(Student.findById).toHaveBeenCalledWith('s14');
    expect(chain.select).toHaveBeenCalledWith('firstname');
    expect(chain.populate).toHaveBeenCalledWith('agents', 'firstname lastname');
    expect(result).toBe(live);
  });

  it('searchStudentsByText sorts by textScore, limits and selects', async () => {
    const docs = [{ _id: 's15' }];
    const chain = leanChain(docs);
    Student.find.mockReturnValue(chain);

    const filter = { $text: { $search: 'jane' } };
    const result = await StudentDAO.searchStudentsByText(
      filter,
      'firstname',
      5
    );

    expect(Student.find).toHaveBeenCalledWith(filter, {
      score: { $meta: 'textScore' }
    });
    expect(chain.sort).toHaveBeenCalledWith({
      score: { $meta: 'textScore' }
    });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('firstname');
    expect(result).toBe(docs);
  });

  it('searchStudentsByText defaults the limit to 10', async () => {
    const chain = leanChain([]);
    Student.find.mockReturnValue(chain);

    await StudentDAO.searchStudentsByText({}, 'firstname');

    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it('getStudentsForDocumentThreadIntervals populates team + threads (lean)', async () => {
    const docs = [{ _id: 's16' }];
    const chain = leanChain(docs);
    Student.find.mockReturnValue(chain);

    const result = await StudentDAO.getStudentsForDocumentThreadIntervals({
      archiv: false
    });

    expect(Student.find).toHaveBeenCalledWith({ archiv: false });
    expect(chain.populate).toHaveBeenCalledWith(
      'agents editors',
      'firstname lastname email'
    );
    expect(result).toBe(docs);
  });

  it('findStudentsSelect applies the limit when provided', async () => {
    const docs = [{ _id: 's17' }];
    const { chain, leanQuery } = leanLimitChain(docs);
    Student.find.mockReturnValue(chain);

    const result = await StudentDAO.findStudentsSelect(
      { archiv: false },
      'firstname',
      25
    );

    expect(Student.find).toHaveBeenCalledWith({ archiv: false });
    expect(chain.select).toHaveBeenCalledWith('firstname');
    expect(leanQuery.limit).toHaveBeenCalledWith(25);
    expect(result).toBe(docs);
  });

  it('findStudentsSelect omits the limit when undefined', async () => {
    const { chain, leanQuery } = leanLimitChain([]);
    Student.find.mockReturnValue(chain);

    await StudentDAO.findStudentsSelect({}, 'firstname');

    expect(leanQuery.limit).not.toHaveBeenCalled();
  });

  it('getStudentsForExpenses populates team + threads and returns lean docs', async () => {
    const docs = [{ _id: 's18' }];
    const chain = leanChain(docs);
    Student.find.mockReturnValue(chain);

    const result = await StudentDAO.getStudentsForExpenses({ archiv: false });

    expect(Student.find).toHaveBeenCalledWith({ archiv: false });
    expect(chain.populate).toHaveBeenCalledWith(
      'agents editors',
      'firstname lastname email'
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'generaldocs_threads.doc_thread_id',
      '-messages'
    );
    expect(result).toBe(docs);
  });

  it('getStudentByIdWithAgents populates only agents and returns lean doc', async () => {
    const doc = { _id: 's19' };
    const chain = leanChain(doc);
    Student.findById.mockReturnValue(chain);

    const result = await StudentDAO.getStudentByIdWithAgents('s19');

    expect(Student.findById).toHaveBeenCalledWith('s19');
    expect(chain.populate).toHaveBeenCalledWith(
      'agents',
      'firstname lastname email pictureUrl'
    );
    expect(result).toBe(doc);
  });

  it('getStudentByIdWithTeam populates editors + agents and returns lean doc', async () => {
    const doc = { _id: 's20' };
    const chain = leanChain(doc);
    Student.findById.mockReturnValue(chain);

    const result = await StudentDAO.getStudentByIdWithTeam('s20');

    expect(Student.findById).toHaveBeenCalledWith('s20');
    expect(chain.populate).toHaveBeenCalledWith(
      'editors agents',
      'firstname lastname email archiv pictureUrl'
    );
    expect(result).toBe(doc);
  });

  it('getStudentByIdWithDocThreads selects -taigerai and returns lean doc', async () => {
    const doc = { _id: 's21' };
    const chain = leanChain(doc);
    Student.findById.mockReturnValue(chain);

    const result = await StudentDAO.getStudentByIdWithDocThreads('s21');

    expect(Student.findById).toHaveBeenCalledWith('s21');
    expect(chain.select).toHaveBeenCalledWith('-taigerai');
    expect(result).toBe(doc);
  });

  it('updateStudentById uses findByIdAndUpdate({ new: true }), populates + lean', async () => {
    const updated = { _id: 's22' };
    const chain = leanChain(updated);
    Student.findByIdAndUpdate.mockReturnValue(chain);

    const result = await StudentDAO.updateStudentById('s22', { archiv: true });

    expect(Student.findByIdAndUpdate).toHaveBeenCalledWith(
      's22',
      { archiv: true },
      { new: true }
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'agents editors',
      'firstname lastname email archiv pictureUrl'
    );
    expect(result).toBe(updated);
  });
});

describe('StudentDAO aggregations (forward + result shape only)', () => {
  it('getStudentsWithLatestCommunication returns the aggregation result', async () => {
    const rows = [{ _id: 's1', latestCommunication: { _id: 'c1' } }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getStudentsWithLatestCommunication();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getUnreadCommunicationStudents returns the aggregation result', async () => {
    const rows = [{ _id: 's1' }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getUnreadCommunicationStudents(
      ['s1'],
      'u1'
    );

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getStudentsWithLatestCommunicationSorted returns the aggregation result', async () => {
    const rows = [{ _id: 's2' }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getStudentsWithLatestCommunicationSorted([
      's2'
    ]);

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getStudentsWithCourses returns the aggregation result', async () => {
    const rows = [{ _id: 's3', courses: [] }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getStudentsWithCourses();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getStudentsWithCoursesAndAgents returns the aggregation result', async () => {
    const rows = [{ _id: 's4', courses: [], agents: [] }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getStudentsWithCoursesAndAgents();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getTaigerUsersWithExpenses returns the aggregation result', async () => {
    const rows = [{ _id: 'a1', expenses: [] }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getTaigerUsersWithExpenses();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getStudentsWithExpenses returns the aggregation result', async () => {
    const rows = [{ _id: 's5', expenses: [] }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getStudentsWithExpenses();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getStudentsWithApplications returns the aggregation result', async () => {
    const rows = [{ _id: 's6', applications: [] }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await StudentDAO.getStudentsWithApplications({
      archiv: false
    });

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });
});

describe('StudentDAO.getStudentsPaginated (mocked models)', () => {
  it('runs the aggregation, hydrates the page ids and restores order', async () => {
    // Aggregation returns the page of ids (sorted) + a total under $facet.
    const id1 = { toString: () => 'id1' };
    const id2 = { toString: () => 'id2' };
    const aggResult = {
      rows: [{ _id: id2 }, { _id: id1 }],
      total: [{ count: 9 }]
    };
    Student.aggregate.mockReturnValue(aggDiskChain([aggResult]));

    // Hydrate returns docs unordered relative to the id order; DAO re-sorts.
    const docs = [
      { _id: { toString: () => 'id1' } },
      { _id: { toString: () => 'id2' } }
    ];
    Student.find.mockReturnValue(leanChain(docs));

    const res = await StudentDAO.getStudentsPaginated({
      filter: {},
      query: { page: 1, limit: 20 }
    });

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(Student.find).toHaveBeenCalledWith({ _id: { $in: [id2, id1] } });
    expect(res.total).toBe(9);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
    // Order restored to match the aggregation's id ordering (id2 then id1).
    expect(res.students.map((d) => d._id.toString())).toEqual(['id2', 'id1']);
  });

  it('short-circuits the hydrate when the aggregation yields no ids', async () => {
    Student.aggregate.mockReturnValue(
      aggDiskChain([{ rows: [], total: [{ count: 0 }] }])
    );

    const res = await StudentDAO.getStudentsPaginated({
      filter: {},
      query: {}
    });

    expect(res.students).toEqual([]);
    expect(res.total).toBe(0);
    expect(Student.find).not.toHaveBeenCalled();
  });
});
