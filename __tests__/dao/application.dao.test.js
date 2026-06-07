// DAO-level integration test: exercises the active-applications aggregation
// (sort by derived deadlineDate, pagination, search, filters, studentId
// scoping) against the in-memory MongoDB. This is where the query coverage
// lives now that the controller test mocks the DAO.
const { connect, clearDatabase } = require('../fixtures/db');
const { Application, Program, User } = require('../../models');
const ApplicationDAO = require('../../dao/application.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, student } = require('../mock/user');
const { program1 } = require('../mock/programs');

// Deterministic string deadlines + semesters so the derived deadlineDate is
// predictable. With application_year 2025: Alpha WS 01-15 -> 2025/01/15,
// Beta SS 05-01 -> 2024/05/01, Gamma WS 11-30 -> 2024/11/30. So deadline-asc
// order is Beta, Gamma, Alpha.
const progAlpha = {
  ...program1,
  _id: undefined,
  program_name: 'Alpha Program',
  school: 'Aalto University',
  country: 'Finland',
  semester: 'WS',
  application_deadline: '01-15'
};
const progBeta = {
  ...program1,
  _id: undefined,
  program_name: 'Beta Program',
  school: 'Berlin University',
  country: 'Germany',
  semester: 'SS',
  application_deadline: '05-01'
};
const progGamma = {
  ...program1,
  _id: undefined,
  program_name: 'Gamma Program',
  school: 'Cologne University',
  country: 'Germany',
  semester: 'WS',
  application_deadline: '11-30'
};

let studentIds;

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Application.deleteMany({});
  await Program.deleteMany({});
  await User.deleteMany({});

  await User.insertMany(users);
  studentIds = [student._id.toString()];

  const [alpha, beta, gamma] = await Program.insertMany([
    progAlpha,
    progBeta,
    progGamma
  ]);
  await Application.insertMany(
    [alpha, beta, gamma].map((prog) => ({
      studentId: student._id,
      programId: prog._id,
      application_year: '2025',
      decided: 'O',
      closed: '-'
    }))
  );
});

const names = (res) =>
  res.applications.map((application) => application.programId.program_name);

describe('ApplicationDAO.getActiveStudentsApplicationsPaginated (in-memory)', () => {
  it('orders by the derived deadlineDate ascending with a total count', async () => {
    const res = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query: { page: 1, limit: 20, sortBy: 'deadline', sortOrder: 'asc' }
    });

    expect(res.total).toBe(3);
    expect(names(res)).toEqual([
      'Beta Program',
      'Gamma Program',
      'Alpha Program'
    ]);
  });

  it('paginates: limit caps the page while total stays the full count', async () => {
    const page1 = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query: { page: 1, limit: 2, sortBy: 'deadline', sortOrder: 'asc' }
    });
    const page2 = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query: { page: 2, limit: 2, sortBy: 'deadline', sortOrder: 'asc' }
    });

    expect(page1.applications).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page2.applications).toHaveLength(1);
    expect(names(page2)).toEqual(['Alpha Program']);
  });

  it('searches across joined program fields', async () => {
    const res = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query: { search: 'Berlin' }
    });

    expect(res.total).toBe(1);
    expect(names(res)).toEqual(['Beta Program']);
  });

  it('filters country via $in (comma-separated multi-select)', async () => {
    const germany = await ApplicationDAO.getActiveStudentsApplicationsPaginated(
      {
        studentIds,
        query: { country: 'Germany' }
      }
    );
    const both = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query: { country: 'Finland,Germany' }
    });

    expect(germany.total).toBe(2);
    expect(both.total).toBe(3);
  });

  it('filters by exact decided/closed status', async () => {
    const decided = await ApplicationDAO.getActiveStudentsApplicationsPaginated(
      {
        studentIds,
        query: { decided: 'O' }
      }
    );
    const none = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query: { decided: 'X' }
    });

    expect(decided.total).toBe(3);
    expect(none.total).toBe(0);
  });

  it('scopes to studentIds (empty scope returns nothing)', async () => {
    const res = await ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds: [],
      query: {}
    });

    expect(res.total).toBe(0);
  });
});
