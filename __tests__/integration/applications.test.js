// Full-stack integration test for the applications routes:
//   supertest -> real router -> real controllers/applications -> real services
//   -> real DAOs -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant/permission middleware is
// stubbed). This is the layer that catches the seam bugs (schema / aggregation /
// populate / deadline derivation) the mocked controller unit test
// (../controllers/applications.test.js) cannot see. Kept thin but deterministic:
// happy paths asserting real persisted data and computed aggregations.

const fs = require('fs');
const mongoose = require('mongoose');
const request = require('supertest');

const { UPLOAD_PATH } = require('../../config');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const {
  InnerTaigerMultitenantFilter
} = require('../../middlewares/InnerTaigerMultitenantFilter');
const {
  permission_canAccessStudentDatabase_filter
} = require('../../middlewares/permission-filter');
const { programSchema } = require('../../models/Program');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { documentThreadsSchema } = require('../../models/Documentthread');
const { users, agent, editor, student, student2 } = require('../mock/user');
const { program1, programs } = require('../mock/programs');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
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
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);
  const ApplicationModel = db.model('Application');

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();
  await ApplicationModel.deleteMany();

  await UserModel.insertMany(users);
  await ProgramModel.insertMany(programs);

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) =>
    next()
  );
  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => next()
  );
});

afterEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);
  const ApplicationModel = db.model('Application');

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();
  await ApplicationModel.deleteMany();

  fs.rmSync(UPLOAD_PATH, { recursive: true, force: true });
});

describe('POST /api/applications/student/:studentId (full stack)', () => {
  it('creates applications for the student and returns 201', async () => {
    const { _id: studentId } = student;
    const programs_arr = programs.map((pro) => pro._id.toString());

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: programs_arr });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(programs_arr.length);
  });
});

describe('GET /api/applications/student/:studentId (full stack)', () => {
  it('returns the applications created for a student', async () => {
    const { _id: studentId } = student2;
    const programs_arr = programs.map((pro) => pro._id.toString());

    const createResp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: programs_arr });

    expect(createResp.status).toBe(201);

    const resp = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.applications).toHaveLength(programs_arr.length);
  });
});

describe('DELETE /api/applications/application/:applicationId (full stack)', () => {
  it('deletes an application so the student then has none', async () => {
    const { _id: studentId } = student2;

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id.toString()] });

    expect(resp.status).toBe(201);
    const applicationId = resp.body.data[0]._id;

    const del = await requestWithSupertest
      .delete(`/api/applications/application/${applicationId}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const after = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(after.body.data.applications).toHaveLength(0);
  });

  it('refuses to delete an application whose thread has a message (409)', async () => {
    const { _id: studentId } = student2;

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id.toString()] });

    expect(resp.status).toBe(201);

    const stdResp = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);
    expect(stdResp.status).toBe(200);

    const application = stdResp.body.data.applications.find(
      (appl) => appl.programId._id?.toString() === program1._id?.toString()
    );
    const thread = application.doc_modification_thread.find(
      (thr) => thr.doc_thread_id.file_type === 'ML'
    );
    expect(thread.doc_thread_id.file_type).toBe('ML');
    const messagesThreadId = thread.doc_thread_id._id?.toString();

    const msg = await requestWithSupertest
      .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
      .set('tenantId', TENANT_ID)
      .field('message', '{}');
    expect(msg.status).toBe(200);

    const del = await requestWithSupertest
      .delete(`/api/applications/application/${application._id}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(409);
  });
});

// Paginated / sorted / searchable active applications. Deterministic deadlines
// so the derived deadlineDate ordering is predictable. With application_year
// 2025: Alpha WS 01-15 -> 2025/01/15; Beta SS 05-01 -> 2024/05/01; Gamma WS
// 11-30 -> 2024/11/30 => ascending: Beta, Gamma, Alpha.
describe('GET /api/applications/all/active/applications/paginated (full stack)', () => {
  const PAGINATED_URL = '/api/applications/all/active/applications/paginated';

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

  beforeEach(async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramModel = db.model('Program', programSchema);
    const ApplicationModel = db.model('Application');

    const created = await ProgramModel.insertMany([
      progAlpha,
      progBeta,
      progGamma
    ]);
    const [alpha, beta, gamma] = created;

    await ApplicationModel.insertMany(
      [alpha, beta, gamma].map((prog) => ({
        studentId: student._id,
        programId: prog._id,
        application_year: '2025',
        decided: 'O',
        closed: '-'
      }))
    );
  });

  const deadlineNames = (resp) =>
    resp.body.data.applications.map(
      (application) => application.programId.program_name
    );

  it('returns the deadline-ascending page with the total count', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?page=1&limit=20&sortBy=deadline&sortOrder=asc`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.total).toBe(3);
    expect(deadlineNames(resp)).toEqual([
      'Beta Program',
      'Gamma Program',
      'Alpha Program'
    ]);
  });

  it('paginates: limit caps the page while total stays the full count', async () => {
    const page1 = await requestWithSupertest
      .get(`${PAGINATED_URL}?page=1&limit=2&sortBy=deadline&sortOrder=asc`)
      .set('tenantId', TENANT_ID);
    const page2 = await requestWithSupertest
      .get(`${PAGINATED_URL}?page=2&limit=2&sortBy=deadline&sortOrder=asc`)
      .set('tenantId', TENANT_ID);

    expect(page1.body.data.applications).toHaveLength(2);
    expect(page1.body.data.total).toBe(3);
    expect(page2.body.data.applications).toHaveLength(1);
    expect(deadlineNames(page1)).toEqual(['Beta Program', 'Gamma Program']);
    expect(deadlineNames(page2)).toEqual(['Alpha Program']);
  });

  it('searches across joined program fields', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?search=Berlin`)
      .set('tenantId', TENANT_ID);

    expect(resp.body.data.total).toBe(1);
    expect(deadlineNames(resp)).toEqual(['Beta Program']);
  });

  it('scopes to a supervising TaiGer user (my-students paginated)', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const UserModel = db.model('User', UserSchema);
    await UserModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(student._id) },
      { $set: { agents: [new mongoose.Types.ObjectId(agent._id)] } }
    );

    const mine = await requestWithSupertest
      .get(`${PAGINATED_URL}?userId=${agent._id}&sortBy=program_name`)
      .set('tenantId', TENANT_ID);
    const other = await requestWithSupertest
      .get(`${PAGINATED_URL}?userId=${student2._id}`)
      .set('tenantId', TENANT_ID);

    expect(mine.status).toBe(200);
    expect(mine.body.data.total).toBe(3);
    expect(other.body.data.total).toBe(0);
  });

  it('returns the deadline distribution (active vs potentials) computed in the DB', async () => {
    const resp = await requestWithSupertest
      .get('/api/applications/distribution')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data).toEqual([
      { name: '2024/05/01', active: 1, potentials: 0 },
      { name: '2024/11/30', active: 1, potentials: 0 },
      { name: '2025/01/15', active: 1, potentials: 0 }
    ]);
  });

  it('returns distinct programs for the update-status tabs', async () => {
    const resp = await requestWithSupertest
      .get('/api/applications/program-update-status')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data.map((p) => p.program_name)).toEqual([
      'Alpha Program',
      'Beta Program',
      'Gamma Program'
    ]);
  });

  it('returns aggregated application stats for a supervising user', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const UserModel = db.model('User', UserSchema);
    await UserModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(student._id) },
      { $set: { agents: [new mongoose.Types.ObjectId(agent._id)] } }
    );

    const resp = await requestWithSupertest
      .get(`/api/applications/taiger-user/${agent._id}/stats`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data.stats).toMatchObject({
      totalStudents: 1,
      totalApplications: 3,
      decidedYesApplications: 3,
      pendingApplications: 3
    });
    expect(resp.body.data.user._id.toString()).toBe(agent._id.toString());
  });
});
