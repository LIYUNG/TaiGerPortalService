// DAO-level integration test for SearchDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { User } = require('../../models');
const SearchDAO = require('../../dao/search.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users } = require('../mock/user');

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

describe('SearchDAO.searchStudentsByName (in-memory, regex)', () => {
  it('matches students by a case-insensitive name fragment', async () => {
    const sample = users.find((u) => u.role === 'Student');

    const res = await SearchDAO.searchStudentsByName(
      sample.firstname.slice(0, 3).toLowerCase()
    );

    expect(res.length).toBeGreaterThanOrEqual(1);
    // Only students are returned.
    expect(res.every((u) => u.role === 'Student')).toBe(true);
    expect(res.some((u) => u._id.toString() === sample._id.toString())).toBe(
      true
    );
  });

  it('returns an empty array when nothing matches', async () => {
    const res = await SearchDAO.searchStudentsByName('zzzznomatchzzzz');
    expect(res).toEqual([]);
  });

  it('caps the result set at 6', async () => {
    const res = await SearchDAO.searchStudentsByName('');
    expect(res.length).toBeLessThanOrEqual(6);
  });
});
