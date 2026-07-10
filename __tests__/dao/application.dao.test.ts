// ApplicationDAO unit tests for getStudentsApplicationsPaginated — the
// active-applications read is a thin orchestration over the Application model
// (an aggregation that returns the page of ids + a total, then a populated
// hydrate of those ids). We mock the model entirely (NO database). The
// aggregation pipeline logic itself is validated by the integration suite
// (__tests__/integration); here we only assert the DAO wires the aggregation
// result into the hydrate + return shape.
jest.mock('../../models', () => {
  const model = () => ({
    aggregate: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    bulkWrite: jest.fn(),
    deleteMany: jest.fn()
  });
  return {
    Application: model(),
    Documentthread: model()
  };
});

import {
  Application as ApplicationModel,
  Documentthread as DocumentthreadModel
} from '../../models';
import ApplicationDAO from '../../dao/application.dao';

// The models are auto-mocked above (every method is a jest.fn()); retype them
// so the mock API (mockReturnValue/…) is visible to the type-checker.
const Application = ApplicationModel as unknown as Record<string, jest.Mock>;
const Documentthread = DocumentthreadModel as unknown as Record<
  string,
  jest.Mock
>;

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (populate/select) return the same chain so they compose.
const leanQueryChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

// A query chain that is itself thenable (no terminal `.lean()`): awaiting it
// resolves to `value`, while builder calls return the same chain.
const liveQueryChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    then: (resolve: any, reject: any) =>
      Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

// The aggregation is called as `Application.aggregate(pipeline).allowDiskUse(true)`
// and awaited, so allowDiskUse must return a promise resolving to the rows.
const aggResultChain = (value: unknown) => ({
  allowDiskUse: jest.fn().mockResolvedValue(value)
});

// populateActiveApplications chains four .populate() calls and ends in .lean().
const leanChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ApplicationDAO.getStudentsApplicationsPaginated (mocked models)', () => {
  it('returns the empty page without touching the model when studentIds is empty', async () => {
    const res = await ApplicationDAO.getStudentsApplicationsPaginated({
      studentIds: [],
      query: { page: 1, limit: 20 }
    });

    expect(res).toEqual({ applications: [], total: 0, page: 1, limit: 20 });
    expect(Application.aggregate).not.toHaveBeenCalled();
    expect(Application.find).not.toHaveBeenCalled();
  });

  it('runs the aggregation, hydrates the page ids and returns applications + total', async () => {
    // Aggregation returns the page of ids (in sorted order) + a total count.
    const aggResult = {
      rows: [{ _id: 'id2' }, { _id: 'id1' }],
      total: [{ count: 5 }]
    };
    Application.aggregate.mockReturnValue(aggResultChain([aggResult]));

    // Hydrate returns the same docs but unordered relative to the ids; the DAO
    // restores the aggregation order afterwards.
    const docs = [
      { _id: { toString: () => 'id1' } },
      { _id: { toString: () => 'id2' } }
    ];
    Application.find.mockReturnValue(leanChain(docs));

    const res = await ApplicationDAO.getStudentsApplicationsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: { page: 1, limit: 20, sortBy: 'deadline', sortOrder: 'asc' }
    });

    expect(Application.aggregate).toHaveBeenCalledTimes(1);
    expect(Application.find).toHaveBeenCalledWith({
      _id: { $in: ['id2', 'id1'] }
    });
    expect(res.total).toBe(5);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
    // Order restored to match the aggregation's id ordering (id2 then id1).
    expect(res.applications.map((d: any) => d._id.toString())).toEqual([
      'id2',
      'id1'
    ]);
  });

  it('short-circuits the hydrate when the aggregation yields no ids', async () => {
    const aggResult = { rows: [], total: [] };
    Application.aggregate.mockReturnValue(aggResultChain([aggResult]));

    const res = await ApplicationDAO.getStudentsApplicationsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: {}
    });

    expect(res.applications).toEqual([]);
    expect(res.total).toBe(0);
    expect(Application.find).not.toHaveBeenCalled();
  });

  it('accepts an already-array program-array filter (country as array)', async () => {
    Application.aggregate.mockReturnValue(
      aggResultChain([{ rows: [], total: [] }])
    );

    await ApplicationDAO.getStudentsApplicationsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: { country: ['de', 'nl'] }
    });

    const pipeline = Application.aggregate.mock.calls[0][0];
    const postMatch = pipeline.find((s: any) => s.$match && s.$match.$and)
      .$match.$and;
    const countryCond = postMatch.find((c: any) => c['prog.country']);
    expect(countryCond['prog.country'].$in).toEqual(['de', 'nl']);
  });

  it('applies application-exact, program-array/text and name $or filters + global search', async () => {
    Application.aggregate.mockReturnValue(
      aggResultChain([{ rows: [], total: [] }])
    );

    await ApplicationDAO.getStudentsApplicationsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: {
        decided: 'O',
        application_year: '2025',
        country: 'de,nl',
        semester: 'WS',
        program: 'TUM',
        studentName: 'Jane',
        agentName: 'Bob',
        editorName: 'Eve',
        search: 'foo.bar',
        sortBy: 'firstname_lastname',
        sortOrder: 'desc'
      }
    });

    const pipeline = Application.aggregate.mock.calls[0][0];
    // preMatch ($match[0]) carries the application-exact filters.
    const preMatch = pipeline[0].$match;
    expect(preMatch.decided).toBe('O');
    expect(preMatch.application_year).toBe('2025');
    // Agent/editor name filters add their own $lookup stages.
    const lookupAliases = pipeline
      .filter((s: any) => s.$lookup)
      .map((s: any) => s.$lookup.as);
    expect(lookupAliases).toContain('agents');
    expect(lookupAliases).toContain('editors');
    // A post-lookup $match holds the joined-field $and conditions + search.
    const postMatch = pipeline.find((s: any) => s.$match && s.$match.$and)
      .$match.$and;
    const flat = JSON.stringify(postMatch);
    expect(flat).toContain('prog.country');
    expect(flat).toContain('prog.semester');
    expect(flat).toContain('student.firstname');
    // Search regex metacharacters are escaped (foo\\.bar).
    expect(flat).toContain('foo\\\\.bar');
  });
});

describe('ApplicationDAO simple reads / writes (mocked models)', () => {
  it('createApplication creates with studentId + programId', async () => {
    const created = { _id: 'a1' };
    Application.create.mockResolvedValue(created);

    const result = await ApplicationDAO.createApplication('s1', 'p1');

    expect(Application.create).toHaveBeenCalledWith({
      studentId: 's1',
      programId: 'p1'
    });
    expect(result).toBe(created);
  });

  it('createApplicationDoc forwards the payload to create', async () => {
    const created = { _id: 'a2' };
    Application.create.mockResolvedValue(created);

    const result = await ApplicationDAO.createApplicationDoc({
      studentId: 's'
    });

    expect(Application.create).toHaveBeenCalledWith({ studentId: 's' });
    expect(result).toBe(created);
  });

  it('findByStudentIdPopulatedBasic populates a slim program (lean)', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.findByStudentIdPopulatedBasic('s1');

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.populate).toHaveBeenCalledWith(
      'programId',
      '_id school program_name degree semester'
    );
    expect(result).toBe(docs);
  });

  it('findByStudentIdPopulatedFull populates program + doc-thread (lean)', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.findByStudentIdPopulatedFull('s1');

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.populate).toHaveBeenCalledWith(
      'doc_modification_thread.doc_thread_id',
      '-messages'
    );
    expect(result).toBe(docs);
  });

  it('getApplicationDocByIdWithProgram returns the live populated doc', async () => {
    const live = { _id: 'a', save: jest.fn() };
    const chain = liveQueryChain(live);
    Application.findById.mockReturnValue(chain);

    const result = await ApplicationDAO.getApplicationDocByIdWithProgram('a');

    expect(Application.findById).toHaveBeenCalledWith('a');
    expect(chain.populate).toHaveBeenCalledWith('programId');
    expect(result).toBe(live);
  });

  it('getApplicationByIdWithStudentProgram populates student + program (live)', async () => {
    const live = { _id: 'a' };
    const chain = liveQueryChain(live);
    Application.findById.mockReturnValue(chain);

    const result = await ApplicationDAO.getApplicationByIdWithStudentProgram(
      'a'
    );

    expect(Application.findById).toHaveBeenCalledWith('a');
    expect(chain.populate).toHaveBeenCalledWith('studentId');
    expect(chain.populate).toHaveBeenCalledWith('programId');
    expect(result).toBe(live);
  });

  it('aggregateApplications forwards the pipeline to aggregate', async () => {
    const out = [{ _id: 1 }];
    Application.aggregate.mockResolvedValue(out);

    const pipeline = [{ $match: {} }];
    const result = await ApplicationDAO.aggregateApplications(pipeline);

    expect(Application.aggregate).toHaveBeenCalledWith(pipeline);
    expect(result).toBe(out);
  });

  it('findApplicationsSelectPopulate selects only (no populate) when populate omitted', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.findApplicationsSelectPopulate(
      { studentId: 's1' },
      'closed decided'
    );

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.select).toHaveBeenCalledWith('closed decided');
    expect(chain.populate).not.toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  it('findApplicationsSelectPopulate populates when populate provided', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.findApplicationsSelectPopulate(
      {},
      'closed',
      { path: 'programId', select: 'school' }
    );

    expect(chain.populate).toHaveBeenCalledWith('programId', 'school');
    expect(result).toBe(docs);
  });

  it('findByStudentIdLean returns lean applications for a student', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.findByStudentIdLean('s1');

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(result).toBe(docs);
  });

  it('findByStudentIdWithProgram returns live applications with program', async () => {
    const docs = [{ _id: 'a' }];
    const chain = liveQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.findByStudentIdWithProgram('s1');

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.populate).toHaveBeenCalledWith('programId');
    expect(result).toBe(docs);
  });

  it('findConflictApplications populates the student with slim fields', async () => {
    const docs = [{ _id: 'a' }];
    const chain = liveQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const filter = { decided: 'O' };
    const result = await ApplicationDAO.findConflictApplications(filter);

    expect(Application.find).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith(
      'studentId',
      'firstname lastname pictureUrl'
    );
    expect(result).toBe(docs);
  });

  it('pullDocModificationThread $pulls the thread subdoc by id', async () => {
    const res = { _id: 'a' };
    Application.findOneAndUpdate.mockResolvedValue(res);

    const result = await ApplicationDAO.pullDocModificationThread(
      '64b000000000000000000001',
      '64b000000000000000000002'
    );

    const call = Application.findOneAndUpdate.mock.calls[0];
    expect(call[0]._id.toString()).toBe('64b000000000000000000001');
    expect(
      call[1].$pull.doc_modification_thread.doc_thread_id._id.toString()
    ).toBe('64b000000000000000000002');
    expect(result).toBe(res);
  });

  it('getDecidedApplicationsByProgramPopulated queries decided=O with nested populate (lean)', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result =
      await ApplicationDAO.getDecidedApplicationsByProgramPopulated('p1');

    expect(Application.find).toHaveBeenCalledWith({
      programId: 'p1',
      decided: 'O'
    });
    expect(chain.populate).toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  it('unlockApplication sets isLocked=false and returns the new lean doc', async () => {
    const updated = { _id: 'a', isLocked: false };
    const chain = leanQueryChain(updated);
    Application.findByIdAndUpdate.mockReturnValue(chain);

    const result = await ApplicationDAO.unlockApplication('a');

    expect(Application.findByIdAndUpdate).toHaveBeenCalledWith(
      'a',
      { isLocked: false },
      { new: true }
    );
    expect(result).toBe(updated);
  });

  it('updateApplicationsBulk forwards updates to bulkWrite', async () => {
    const res = { modifiedCount: 2 };
    Application.bulkWrite.mockResolvedValue(res);

    const updates = [{ updateOne: {} }] as any;
    const result = await ApplicationDAO.updateApplicationsBulk(updates);

    expect(Application.bulkWrite).toHaveBeenCalledWith(updates);
    expect(result).toBe(res);
  });
});

describe('ApplicationDAO.getApplications builder (mocked models)', () => {
  // getApplications returns the live query builder; populate/select are invoked
  // on it conditionally. We model the builder as a chain with spies.
  const builder = (): any => {
    const chain: any = {
      populate: jest.fn(() => chain),
      select: jest.fn(() => chain),
      lean: jest.fn().mockResolvedValue([{ _id: 'a' }])
    };
    return chain;
  };

  it('populates programId + doc thread by default and returns the query', () => {
    const chain = builder();
    Application.find.mockReturnValue(chain);

    const result = ApplicationDAO.getApplications({ studentId: 's1' });

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.populate).toHaveBeenCalledWith('programId');
    expect(chain.populate).toHaveBeenCalledTimes(2);
    expect(chain.select).not.toHaveBeenCalled();
    expect(result).toBe(chain);
  });

  it('skips populate when populate is false-ish ("false")', () => {
    const chain = builder();
    Application.find.mockReturnValue(chain);

    ApplicationDAO.getApplications({}, [], 'false');

    expect(chain.populate).not.toHaveBeenCalled();
  });

  it('applies select when a non-empty select array is given', () => {
    const chain = builder();
    Application.find.mockReturnValue(chain);

    ApplicationDAO.getApplications({}, ['closed', 'decided'], false);

    expect(chain.select).toHaveBeenCalledWith('closed decided');
    expect(chain.populate).not.toHaveBeenCalled();
  });

  it('getApplicationsWithStudentDetails populates student/program/thread (lean)', async () => {
    const docs = [{ _id: 'a' }];
    const chain = leanQueryChain(docs);
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.getApplicationsWithStudentDetails({
      decided: 'O'
    });

    expect(Application.find).toHaveBeenCalledWith({ decided: 'O' });
    expect(chain.populate).toHaveBeenCalledTimes(3);
    expect(result).toBe(docs);
  });

  it('getApplicationsByStudentId delegates to getApplications().lean()', async () => {
    const chain = builder();
    Application.find.mockReturnValue(chain);

    const result = await ApplicationDAO.getApplicationsByStudentId('s1');

    expect(Application.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.lean).toHaveBeenCalled();
    expect(result).toEqual([{ _id: 'a' }]);
  });

  it('getApplicationsWithCredentialsByStudentId selects the +portal fields', async () => {
    const chain = builder();
    Application.find.mockReturnValue(chain);

    await ApplicationDAO.getApplicationsWithCredentialsByStudentId('s1');

    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining(
        '+portal_credentials.application_portal_a.account'
      )
    );
    expect(chain.lean).toHaveBeenCalled();
  });

  it('getApplicationsByProgramId filters by programId (lean)', async () => {
    const chain = builder();
    Application.find.mockReturnValue(chain);

    await ApplicationDAO.getApplicationsByProgramId('p1');

    expect(Application.find).toHaveBeenCalledWith({ programId: 'p1' });
    expect(chain.lean).toHaveBeenCalled();
  });
});

describe('ApplicationDAO id read / update (mocked models)', () => {
  it('getApplicationById populates program + thread (live)', async () => {
    const live = { _id: 'a' };
    const chain = liveQueryChain(live);
    Application.findById.mockReturnValue(chain);

    const result = await ApplicationDAO.getApplicationById('a');

    expect(Application.findById).toHaveBeenCalledWith('a');
    expect(chain.populate).toHaveBeenCalledWith('programId');
    expect(chain.populate).toHaveBeenCalledWith(
      'doc_modification_thread.doc_thread_id',
      '-messages'
    );
    expect(result).toBe(live);
  });

  it('updateApplication uses findOneAndUpdate({new:true}).populate.lean', async () => {
    const updated = { _id: 'a' };
    const chain = leanQueryChain(updated);
    Application.findOneAndUpdate.mockReturnValue(chain);

    const filter = { _id: 'a' };
    const result = await ApplicationDAO.updateApplication(filter, {
      decided: 'O'
    });

    expect(Application.findOneAndUpdate).toHaveBeenCalledWith(
      filter,
      { decided: 'O' },
      { new: true }
    );
    expect(chain.populate).toHaveBeenCalledWith('programId');
    expect(result).toBe(updated);
  });
});

describe('ApplicationDAO.deleteApplication (mocked models)', () => {
  it('throws 404 when the application does not exist', async () => {
    Application.findById.mockReturnValue(liveQueryChain(null));

    await expect(ApplicationDAO.deleteApplication('missing')).rejects.toThrow(
      'Application not found'
    );
    expect(Application.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('throws 409 when a related thread still has messages', async () => {
    Application.findById.mockReturnValue(liveQueryChain({ _id: 'a' }));
    Documentthread.find.mockReturnValue(
      leanQueryChain([{ _id: 't1', messages: [{ _id: 'm1' }] }])
    );

    await expect(ApplicationDAO.deleteApplication('a')).rejects.toThrow(
      /discussion threads/
    );
    expect(Documentthread.deleteMany).not.toHaveBeenCalled();
    expect(Application.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('deletes empty threads then the application', async () => {
    Application.findById.mockReturnValue(liveQueryChain({ _id: 'a' }));
    Documentthread.find.mockReturnValue(
      leanQueryChain([
        { _id: '64b000000000000000000010', messages: [] },
        { _id: '64b000000000000000000011', messages: [] }
      ])
    );
    Documentthread.deleteMany.mockResolvedValue({ deletedCount: 2 });
    Application.findByIdAndDelete.mockResolvedValue({ _id: 'a' });

    await ApplicationDAO.deleteApplication('a');

    const delCall = Documentthread.deleteMany.mock.calls[0][0];
    expect(delCall._id.$in).toHaveLength(2);
    expect(Application.findByIdAndDelete).toHaveBeenCalledWith('a');
  });
});

describe('ApplicationDAO admissions/program aggregations (mocked models)', () => {
  it('getAdmissionsStatusCounts returns the first aggregation row', async () => {
    const row = { admission: 3, rejection: 1, pending: 2, notYetSubmitted: 4 };
    Application.aggregate.mockResolvedValue([row]);

    const result = await ApplicationDAO.getAdmissionsStatusCounts();

    expect(Application.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(row);
  });

  it('getAdmissionsStatusCounts returns zeros when empty', async () => {
    Application.aggregate.mockResolvedValue([]);

    const result = await ApplicationDAO.getAdmissionsStatusCounts();

    expect(result).toEqual({
      admission: 0,
      rejection: 0,
      pending: 0,
      notYetSubmitted: 0
    });
  });

  it('getProgramApplicationCounts returns the aggregation array', async () => {
    const rows = [{ id: 'p1', applicationCount: 5 }];
    Application.aggregate.mockResolvedValue(rows);

    const result = await ApplicationDAO.getProgramApplicationCounts();

    expect(result).toBe(rows);
  });

  it('getProgramApplicationCounts returns [] when aggregate is not an array', async () => {
    Application.aggregate.mockResolvedValue(undefined);

    const result = await ApplicationDAO.getProgramApplicationCounts();

    expect(result).toEqual([]);
  });

  it('getApplicationConflicts returns the aggregation result', async () => {
    const rows = [{ programId: 'p1', applicationCount: 2 }];
    Application.aggregate.mockResolvedValue(rows);

    const result = await ApplicationDAO.getApplicationConflicts();

    expect(result).toBe(rows);
  });
});

describe('ApplicationDAO scoped aggregations: empty + result shapes (mocked models)', () => {
  it('getActiveStudentsApplicationsDeadlineDistribution returns [] for no students', async () => {
    const res =
      await ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution({
        studentIds: []
      });
    expect(res).toEqual([]);
    expect(Application.aggregate).not.toHaveBeenCalled();
  });

  it('getActiveStudentsApplicationsDeadlineDistribution runs the aggregation', async () => {
    const out = [{ name: '2025-Rolling', active: 1, potentials: 0 }];
    Application.aggregate.mockReturnValue(aggResultChain(out));

    const res =
      await ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution({
        studentIds: ['64b000000000000000000001']
      });

    expect(Application.aggregate).toHaveBeenCalledTimes(1);
    expect(res).toBe(out);
  });

  it('getApplicationProgramsUpdateStatus returns [] for no students', async () => {
    const res = await ApplicationDAO.getApplicationProgramsUpdateStatus({
      studentIds: []
    });
    expect(res).toEqual([]);
    expect(Application.aggregate).not.toHaveBeenCalled();
  });

  it('getApplicationProgramsUpdateStatus adds a decided match when provided', async () => {
    const out = [{ program_id: 'p1' }];
    Application.aggregate.mockReturnValue(aggResultChain(out));

    const res = await ApplicationDAO.getApplicationProgramsUpdateStatus({
      studentIds: ['64b000000000000000000001'],
      decided: 'O'
    });

    const pipeline = Application.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.decided).toBe('O');
    expect(res).toBe(out);
  });

  it('getApplicationProgramsUpdateStatus omits decided match when not provided', async () => {
    Application.aggregate.mockReturnValue(aggResultChain([]));

    await ApplicationDAO.getApplicationProgramsUpdateStatus({
      studentIds: ['64b000000000000000000001']
    });

    const pipeline = Application.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.decided).toBeUndefined();
  });

  it('getApplicationStatusStats returns zeros for no students', async () => {
    const res = await ApplicationDAO.getApplicationStatusStats({
      studentIds: []
    });
    expect(res).toEqual({
      totalApplications: 0,
      decidedYesApplications: 0,
      decidedNoApplications: 0,
      undecidedApplications: 0,
      submittedApplications: 0,
      pendingApplications: 0
    });
    expect(Application.aggregate).not.toHaveBeenCalled();
  });

  it('getApplicationStatusStats returns the aggregation row when present', async () => {
    const row = {
      totalApplications: 9,
      decidedYesApplications: 3,
      decidedNoApplications: 1,
      undecidedApplications: 5,
      submittedApplications: 2,
      pendingApplications: 1
    };
    Application.aggregate.mockResolvedValue([row]);

    const res = await ApplicationDAO.getApplicationStatusStats({
      studentIds: ['64b000000000000000000001']
    });

    expect(res).toBe(row);
  });

  it('getApplicationStatusStats falls back to zeros when the group is empty', async () => {
    Application.aggregate.mockResolvedValue([undefined]);

    const res = await ApplicationDAO.getApplicationStatusStats({
      studentIds: ['64b000000000000000000001']
    });

    expect(res.totalApplications).toBe(0);
  });
});
