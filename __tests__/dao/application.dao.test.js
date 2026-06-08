// ApplicationDAO unit tests for getActiveStudentsApplicationsPaginated — the
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
    create: jest.fn()
  });
  return {
    Application: model(),
    Documentthread: model()
  };
});

const { Application } = require('../../models');
const ApplicationDAO = require('../../dao/application.dao');

// The aggregation is called as `Application.aggregate(pipeline).allowDiskUse(true)`
// and awaited, so allowDiskUse must return a promise resolving to the rows.
const aggResultChain = (value) => ({
  allowDiskUse: jest.fn().mockResolvedValue(value)
});

// populateActiveApplications chains four .populate() calls and ends in .lean().
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

describe('ApplicationDAO.getActiveStudentsApplicationsPaginated (mocked models)', () => {
  it('returns the empty page without touching the model when studentIds is empty', async () => {
    const res = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
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

    const res = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
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
    expect(res.applications.map((d) => d._id.toString())).toEqual([
      'id2',
      'id1'
    ]);
  });

  it('short-circuits the hydrate when the aggregation yields no ids', async () => {
    const aggResult = { rows: [], total: [] };
    Application.aggregate.mockReturnValue(aggResultChain([aggResult]));

    const res = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds: ['64b000000000000000000001'],
      query: {}
    });

    expect(res.applications).toEqual([]);
    expect(res.total).toBe(0);
    expect(Application.find).not.toHaveBeenCalled();
  });
});
