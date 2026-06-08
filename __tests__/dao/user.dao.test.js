// UserDAO unit tests — the DAO is a thin query-building layer over the Mongoose
// models, so we mock the models entirely (NO database, in-memory or otherwise).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result. Real query/aggregation behaviour is covered by
// the integration suite (__tests__/integration), which runs against in-memory
// MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn()
  });
  return {
    User: model(),
    Agent: model(),
    Editor: model(),
    Student: model(),
    Guest: model(),
    Documentthread: model(),
    Application: model(),
    Course: model(),
    Communication: model(),
    Complaint: model(),
    Event: model(),
    Interview: model(),
    surveyInput: model(),
    Ticket: model()
  };
});

const { User } = require('../../models');
const UserDAO = require('../../dao/user.dao');

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (select/sort/skip/limit) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UserDAO.parseUsersPaginationQuery (pure)', () => {
  it('applies defaults and clamps the limit', () => {
    const parsed = UserDAO.parseUsersPaginationQuery({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.skip).toBe(0);

    const clamped = UserDAO.parseUsersPaginationQuery({ limit: '5000' });
    expect(clamped.limit).toBe(100);
  });

  it('computes skip and a desc sort with a firstname tiebreak', () => {
    const parsed = UserDAO.parseUsersPaginationQuery({
      page: '3',
      limit: '10',
      sortBy: 'lastname',
      sortOrder: 'desc'
    });
    expect(parsed.skip).toBe(20);
    expect(parsed.sort).toEqual({ lastname: -1, firstname: 1 });
  });

  it('falls back to lastname sort for a disallowed sortBy', () => {
    const parsed = UserDAO.parseUsersPaginationQuery({ sortBy: 'password' });
    expect(parsed.sort).toHaveProperty('lastname');
  });
});

describe('UserDAO (mocked models)', () => {
  it('getUserById queries by id and returns the lean doc', async () => {
    const doc = { _id: 'u1', firstname: 'A' };
    User.findById.mockReturnValue(leanChain(doc));

    const found = await UserDAO.getUserById('u1');

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(found).toBe(doc);
  });

  it('getUserByEmail queries by email and returns the lean doc', async () => {
    const doc = { _id: 'u2', email: 'x@y.z' };
    User.findOne.mockReturnValue(leanChain(doc));

    const found = await UserDAO.getUserByEmail('x@y.z');

    expect(User.findOne).toHaveBeenCalledWith({ email: 'x@y.z' });
    expect(found).toBe(doc);
  });

  it('getUsers forwards the filter to find().lean()', async () => {
    const docs = [{ role: 'Admin' }];
    User.find.mockReturnValue(leanChain(docs));

    const result = await UserDAO.getUsers({ role: 'Admin' });

    expect(User.find).toHaveBeenCalledWith({ role: 'Admin' });
    expect(result).toBe(docs);
  });

  it('updateUser uses findByIdAndUpdate with { new: true } and returns the doc', async () => {
    const updated = { _id: 'u1', firstname: 'Renamed' };
    User.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const result = await UserDAO.updateUser('u1', { firstname: 'Renamed' });

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { firstname: 'Renamed' },
      { new: true }
    );
    expect(result.firstname).toBe('Renamed');
  });

  it('getUsersPaginated runs the page query + count and returns both', async () => {
    const users = [{ _id: 'a' }, { _id: 'b' }];
    User.find.mockReturnValue(leanChain(users));
    User.countDocuments.mockResolvedValue(7);

    const parsed = UserDAO.parseUsersPaginationQuery({ page: 1, limit: 2 });
    const res = await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    expect(res.users).toBe(users);
    expect(res.total).toBe(7);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(2);
  });

  it('getUsersPaginated injects an $and search filter when search is set', async () => {
    User.find.mockReturnValue(leanChain([]));
    User.countDocuments.mockResolvedValue(0);

    const parsed = UserDAO.parseUsersPaginationQuery({ search: 'jane' });
    await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    const usedFilter = User.find.mock.calls[0][0];
    expect(usedFilter).toHaveProperty('$and');
    expect(usedFilter.$and[0].$or.some((c) => c.firstname)).toBe(true);
    expect(User.countDocuments).toHaveBeenCalledWith(usedFilter);
  });
});
