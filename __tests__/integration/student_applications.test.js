// Full-stack integration test for the student-applications routes:
//   supertest -> real router -> real controllers -> real services -> real DAOs
//   -> in-memory MongoDB.
//
//   GET /conflicts -> controllers/student_applications.getApplicationConflicts
//   GET /deltas    -> controllers/teams.getApplicationDeltas
//
// Only auth/tenant middleware is stubbed; everything below the route is real.
// Both aggregations read the CENTRAL default-connection models (Application,
// User, Program), which the harness connects to the same per-worker db, so the
// seeded docs are visible. We seed a genuine conflict (two students applying to
// the same program, decided 'O' / closed '-') and assert it surfaces, instead of
// the original mocked-service status-only checks. The per-handler HTTP shape is
// covered in ../controllers/student_applications.test.js (mocked).

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn((req, res, next) => {
    req.tenantId = 'test';
    next();
  })
}));
jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn((req, res, next) => next())
}));
jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn((req, res, next) => next()),
  permit: jest.fn(() => (req, res, next) => next())
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { Application, User, Program } = require('../../models');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { admin } = require('../mock/user');
const { generateProgram, generateUser } = require('../fixtures/faker');
const { disconnectFromDatabase } = require('../../database');

const api = request(app);

const { Role } = require('../../constants');

const studentA = generateUser(Role.Student);
const studentB = generateUser(Role.Student);
const conflictProgram = generateProgram();

const makeApplication = (studentId) => ({
  _id: new mongoose.Types.ObjectId().toHexString(),
  studentId,
  programId: conflictProgram._id,
  decided: 'O',
  closed: '-',
  admission: '-'
});

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  // Conflict + delta aggregations read the central default-connection models.
  await User.deleteMany({});
  await Program.deleteMany({});
  await Application.deleteMany({});

  await User.insertMany([studentA, studentB]);
  await Program.create(conflictProgram);
  await Application.insertMany([
    makeApplication(studentA._id),
    makeApplication(studentB._id)
  ]);

  protect.mockImplementation((req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/student-applications/conflicts (full stack)', () => {
  it('surfaces a program with two students competing for the same decided slot', async () => {
    const resp = await api
      .get('/api/student-applications/conflicts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);

    // The aggregation projects _id:0 and renames the grouped program id to
    // `programId`, bundling the program doc under `program`.
    const conflict = resp.body.data.find(
      (c) => c.programId?.toString() === conflictProgram._id.toString()
    );
    expect(conflict).toBeTruthy();
    expect(conflict.applicationCount).toBe(2);
    expect(conflict.students.length).toBe(2);
    expect(conflict.program._id.toString()).toBe(
      conflictProgram._id.toString()
    );
  });

  it('returns no conflict once the competing applications are removed', async () => {
    await Application.deleteMany({});

    const resp = await api
      .get('/api/student-applications/conflicts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual([]);
  });
});

describe('GET /api/student-applications/deltas (full stack)', () => {
  it('returns a 200 success envelope with a data array', async () => {
    const resp = await api
      .get('/api/student-applications/deltas')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});
