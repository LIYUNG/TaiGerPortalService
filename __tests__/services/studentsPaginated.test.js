// Service-level integration test for the students pagination/search aggregation
// (StudentService.getStudentsPaginated), run against the in-memory MongoDB
// through the DEFAULT connection. The HTTP controller (getStudentsV3Paginated)
// is a thin wrapper that builds the scope filter and forwards req.query; here we
// build the same filter and call the service directly so seeding and reading
// share one connection (no per-request-connection split -> no flakiness).
const { connect, clearDatabase } = require('../fixtures/db');
const { User, Student } = require('../../models');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, agent, student, student2 } = require('../mock/user');
const StudentService = require('../../services/students');
const UserQueryBuilder = require('../../builders/UserQueryBuilder');

const studentCount = users.filter((u) => u.role === 'Student').length;

// Mirror the controller: build the scope filter from the query, then forward the
// raw query (page/limit/sort/search/column filters) to the service.
const paginate = (query = {}) => {
  const { filter } = new UserQueryBuilder()
    .withEditors(query.editors)
    .withAgents(query.agents)
    .withArchiv(query.archiv)
    .build();
  return StudentService.getStudentsPaginated({ filter, query });
};

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await User.deleteMany();
  await User.insertMany(users);
});

describe('StudentService.getStudentsPaginated (in-memory)', () => {
  it('returns a page of students with a total count', async () => {
    const { students, total } = await paginate({ page: '1', limit: '20' });

    expect(total).toBe(studentCount);
    expect(students).toHaveLength(studentCount);
  });

  it('caps the page by limit while total stays the full count', async () => {
    const page1 = await paginate({ page: '1', limit: '2', sortBy: 'name_en' });
    const page2 = await paginate({ page: '2', limit: '2', sortBy: 'name_en' });

    expect(page1.students).toHaveLength(2);
    expect(page1.total).toBe(studentCount);
    expect(page2.students).toHaveLength(2);
    // Pages are disjoint (stable sort).
    const ids1 = page1.students.map((s) => s._id.toString());
    const ids2 = page2.students.map((s) => s._id.toString());
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
  });

  it('searches by student name (English)', async () => {
    const { students, total } = await paginate({ search: student.firstname });

    expect(total).toBeGreaterThanOrEqual(1);
    const ids = students.map((s) => s._id.toString());
    expect(ids).toContain(student._id.toString());
    // Every returned student's English name contains the searched term.
    students.forEach((s) => {
      expect(`${s.firstname} ${s.lastname}`.toLowerCase()).toContain(
        student.firstname.toLowerCase()
      );
    });
  });

  it('filters by the name_en column (contains)', async () => {
    const { students } = await paginate({ name_en: student.lastname });

    const ids = students.map((s) => s._id.toString());
    expect(ids).toContain(student._id.toString());
  });

  it('sorts by createdAt (descending = newest first)', async () => {
    const { students } = await paginate({
      sortBy: 'createdAt',
      sortOrder: 'desc'
    });

    const createdAts = students.map((s) => new Date(s.createdAt).getTime());
    const sorted = [...createdAts].sort((a, b) => b - a);
    expect(createdAts).toEqual(sorted);
  });

  it('scopes to students supervised by a given agent id', async () => {
    // Make `agent` supervise `student` only.
    await Student.updateOne(
      { _id: student._id },
      { $set: { agents: [agent._id] } }
    );

    const { students, total } = await paginate({
      agents: agent._id.toString()
    });

    const ids = students.map((s) => s._id.toString());
    expect(ids).toContain(student._id.toString());
    expect(ids).not.toContain(student2._id.toString());
    expect(total).toBe(1);
  });
});
