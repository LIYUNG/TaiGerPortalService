const { connect, clearDatabase } = require('../fixtures/db');
const { User } = require('../../models');
const UserDAO = require('../../dao/user.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, student } = require('../mock/user');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await User.deleteMany({});
  await User.insertMany(users);
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

describe('UserDAO (in-memory)', () => {
  it('getUserById returns the user', async () => {
    const found = await UserDAO.getUserById(admin._id);
    expect(found._id.toString()).toBe(admin._id.toString());
  });

  it('getUserByEmail returns the user', async () => {
    const found = await UserDAO.getUserByEmail(student.email);
    expect(found._id.toString()).toBe(student._id.toString());
  });

  it('getUsers filters by query', async () => {
    const admins = await UserDAO.getUsers({ role: admin.role });
    expect(admins.length).toBeGreaterThanOrEqual(1);
    expect(admins.every((u) => u.role === admin.role)).toBe(true);
  });

  it('updateUser applies the update and returns the new doc', async () => {
    const updated = await UserDAO.updateUser(admin._id, {
      firstname: 'Renamed'
    });
    expect(updated.firstname).toBe('Renamed');
  });

  it('getUsersPaginated returns a page plus the total count', async () => {
    const parsed = UserDAO.parseUsersPaginationQuery({ page: 1, limit: 2 });
    const res = await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    expect(res.users).toHaveLength(2);
    expect(res.total).toBe(users.length);
  });

  it('getUsersPaginated honours the search filter', async () => {
    const parsed = UserDAO.parseUsersPaginationQuery({
      search: student.firstname
    });
    const res = await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(
      res.users.some((u) => u._id.toString() === student._id.toString())
    ).toBe(true);
  });
});
