// Full-stack integration test for the students routes:
//   supertest -> real router -> real controllers/students -> real services ->
//   real DAOs -> in-memory MongoDB.
//
// Thin on purpose: a few critical endpoints exercised end to end so a seam bug
// (schema/populate/persistence) surfaces here. Only auth/tenant/permission
// middleware is stubbed; the services (incl. email, which is a no-op in test)
// run for real. Ported from the original __tests__/controllers/students.test.js,
// keeping the deterministic, persistence-verifying cases (agent + editor
// assignment, single-student read) and dropping the slow multipart upload cases
// — those exercise the files controller, not students. The exhaustive per-handler
// behaviour lives in ../controllers/students.test.js (mocked) and the service
// suites (studentsPaginated / activeThreadsPaginated).

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { Student, UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agents, editors, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };

  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough),
    permission_canAssignAgent_filter: jest.fn().mockImplementation(passthrough),
    permission_canAssignEditor_filter: jest.fn().mockImplementation(passthrough)
  };
});

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('POST /api/students/:id/agents (full stack)', () => {
  it('assigns the agents and persists them on the student', async () => {
    const { _id: studentId } = student;

    const agents_obj = {};
    agents.forEach((ag) => {
      agents_obj[ag._id] = true;
    });

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/agents`)
      .set('tenantId', TENANT_ID)
      .send(agents_obj);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const expectedAgentIds = agents.map((ag) => ag._id.toString());
    const updatedStudent = await Student.findById(studentId).lean();
    expect(updatedStudent.agents.map(String).sort()).toEqual(
      expectedAgentIds.sort()
    );
  });
});

describe('POST /api/students/:id/editors (full stack)', () => {
  it('assigns the editors and persists them on the student', async () => {
    const { _id: studentId } = student;

    const editors_obj = {};
    editors.forEach((editor) => {
      editors_obj[editor._id] = true;
    });

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/editors`)
      .set('tenantId', TENANT_ID)
      .send(editors_obj);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const expectedEditorIds = editors.map((editor) => editor._id.toString());
    const updatedStudent = await Student.findById(studentId).lean();
    expect(updatedStudent.editors.map(String).sort()).toEqual(
      expectedEditorIds.sort()
    );
  });
});

describe('GET /api/students/:studentId (full stack)', () => {
  it('returns the requested student by id', async () => {
    const { _id: studentId } = student;

    const resp = await requestWithSupertest
      .get(`/api/students/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(studentId.toString());
  });
});
