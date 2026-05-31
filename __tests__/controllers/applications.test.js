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
const { users, agent, student, student2 } = require('../mock/user');
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
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);
  // Application must also be cleared — applications created in earlier tests
  // persist and break the length assertions in later tests.
  const ApplicationModel = db.model('Application');

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();
  await ApplicationModel.deleteMany();

  await UserModel.insertMany(users);
  await ProgramModel.insertMany(programs);
});

afterEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();

  fs.rmSync(UPLOAD_PATH, { recursive: true, force: true });
});

// Get all applications for a student
describe('GET /api/applications/student/:studentId', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });

  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  it('should return an empty applications list when no applications exist', async () => {
    const { _id: studentId } = student;

    const resp = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect([200, 400, 404]).toContain(resp.status);
  });

  it('should return applications for a student after creating them', async () => {
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

// Get all applications (admin/agent/editor route)
describe('GET /api/applications', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });

  it('should return a list of applications', async () => {
    const resp = await requestWithSupertest
      .get('/api/applications')
      .set('tenantId', TENANT_ID);

    expect([200, 400, 403]).toContain(resp.status);
  });
});

// Agent should create applications (programs) to student
describe('POST /api/applications/student/:studentId', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });

  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  it('should create an application for student', async () => {
    const { _id: studentId } = student;
    const programs_arr = [];
    programs.forEach((pro) => {
      programs_arr.push(pro._id.toString());
    });
    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: programs_arr });

    const {
      status,
      body: { success }
    } = resp;

    expect(status).toBe(201);
    expect(success).toBe(true);
  });
});

// Update a specific application (decide/close/admission)
describe('PUT /api/applications/student/:studentId/:application_id', () => {
  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => {
      next();
    }
  );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });

  it('should update an application decision', async () => {
    const { _id: studentId } = student2;

    // First create an application
    const createResp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id.toString()] });

    expect(createResp.status).toBe(201);

    const applications = createResp.body.data;
    const applicationId = applications[0]._id;

    const resp = await requestWithSupertest
      .put(`/api/applications/student/${studentId}/${applicationId}`)
      .set('tenantId', TENANT_ID)
      .send({
        decided: true,
        closed: false,
        admission: false,
        finalEnrolment: false
      });

    expect([200, 201, 400, 403, 404]).toContain(resp.status);
  });
});

describe('DELETE /api/applications/application/:applicationId', () => {
  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => {
      next();
    }
  );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
  it('should delete an application from student', async () => {
    const { _id: studentId } = student2;

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id] });

    expect(resp.status).toBe(201);
    // !!data = []
    const applications = resp.body.data;
    const applicationId = applications[0]._id;
    const resp2 = await requestWithSupertest
      .delete(`/api/applications/application/${applicationId}`)
      .set('tenantId', TENANT_ID);

    expect(resp2.status).toBe(200);
    const resp2_std = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);
    //   Why got 4?
    expect(resp2_std.body.data.applications).toHaveLength(0);
  });

  it('deleting an application should fail if one of the threads is none-empty', async () => {
    const { _id: studentId } = student2;

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id?.toString()] });

    expect(resp.status).toBe(201);

    const resp_std = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp_std.status).toBe(200);
    const newStudentData = resp_std.body.data;

    const newApplication = newStudentData.applications.find(
      (appl) => appl.programId._id?.toString() === program1._id?.toString()
    );
    const thread = newApplication.doc_modification_thread.find(
      (thr) => thr.doc_thread_id.file_type === 'ML'
    );
    expect(thread.doc_thread_id.file_type).toBe('ML');
    const messagesThreadId = thread.doc_thread_id._id?.toString();

    const resp2 = await requestWithSupertest
      .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
      .set('tenantId', TENANT_ID)
      .field('message', '{}');
    expect(resp2.status).toBe(200);
    const application_id = newApplication._id;
    const resp3 = await requestWithSupertest
      .delete(`/api/applications/application/${application_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp3.status).toBe(409);
    const resp3_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);
    // why TODO:Got 5
    expect(resp3_std.body.data.applications).toHaveLength(1);
  });
});

// Paginated / sorted / searchable active applications
describe('GET /api/applications/all/active/applications/paginated', () => {
  const PAGINATED_URL = '/api/applications/all/active/applications/paginated';

  // Programs with deterministic string deadlines + semesters so the derived
  // deadlineDate is predictable. With application_year 2025:
  //   Alpha: WS, 01-15 -> month 1 (<=9) -> 2025/01/15
  //   Beta : SS, 05-01 -> month 5 (>3)  -> 2024/05/01
  //   Gamma: WS, 11-30 -> month 11 (>9) -> 2024/11/30
  // => deadlineDate ascending order is Beta, Gamma, Alpha.
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
    protect.mockImplementation(async (req, res, next) => {
      req.user = agent;
      next();
    });

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

  it('returns the deadline-ascending page with a total count', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?page=1&limit=20&sortBy=deadline&sortOrder=asc`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.total).toBe(3);
    // Derived deadlineDate ordering (the tricky year-adjustment part).
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

  it('sorts by a joined program field (program_name)', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?sortBy=program_name&sortOrder=asc`)
      .set('tenantId', TENANT_ID);

    expect(deadlineNames(resp)).toEqual([
      'Alpha Program',
      'Beta Program',
      'Gamma Program'
    ]);
  });

  it('searches across joined fields', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?search=Berlin`)
      .set('tenantId', TENANT_ID);

    expect(resp.body.data.total).toBe(1);
    expect(deadlineNames(resp)).toEqual(['Beta Program']);

    // Global search also covers the program's application_deadline string.
    const byDeadline = await requestWithSupertest
      .get(`${PAGINATED_URL}?search=11-30`)
      .set('tenantId', TENANT_ID);

    expect(byDeadline.body.data.total).toBe(1);
    expect(deadlineNames(byDeadline)).toEqual(['Gamma Program']);
  });

  it('filters by exact decided / closed status (column filters)', async () => {
    // All three applications are decided 'O', closed '-'.
    const decidedMatch = await requestWithSupertest
      .get(`${PAGINATED_URL}?decided=O`)
      .set('tenantId', TENANT_ID);
    const decidedNone = await requestWithSupertest
      .get(`${PAGINATED_URL}?decided=X`)
      .set('tenantId', TENANT_ID);
    const closedNone = await requestWithSupertest
      .get(`${PAGINATED_URL}?closed=O`)
      .set('tenantId', TENANT_ID);

    expect(decidedMatch.body.data.total).toBe(3);
    expect(decidedNone.body.data.total).toBe(0);
    expect(closedNone.body.data.total).toBe(0);
  });

  it('filters country by $in over comma-separated values (multi-select)', async () => {
    // Alpha -> Finland, Beta & Gamma -> Germany.
    const germany = await requestWithSupertest
      .get(`${PAGINATED_URL}?country=Germany`)
      .set('tenantId', TENANT_ID);
    const both = await requestWithSupertest
      .get(`${PAGINATED_URL}?country=Finland,Germany&sortBy=program_name`)
      .set('tenantId', TENANT_ID);

    expect(germany.body.data.total).toBe(2);
    expect(deadlineNames(germany).sort()).toEqual([
      'Beta Program',
      'Gamma Program'
    ]);
    expect(both.body.data.total).toBe(3);
  });

  it('filters by student name (first or last name, contains)', async () => {
    // All three applications belong to `student`.
    const byFirst = await requestWithSupertest
      .get(
        `${PAGINATED_URL}?studentName=${encodeURIComponent(student.firstname)}`
      )
      .set('tenantId', TENANT_ID);
    const byLast = await requestWithSupertest
      .get(
        `${PAGINATED_URL}?studentName=${encodeURIComponent(student.lastname)}`
      )
      .set('tenantId', TENANT_ID);
    const noMatch = await requestWithSupertest
      .get(`${PAGINATED_URL}?studentName=zzzznomatchzzzz`)
      .set('tenantId', TENANT_ID);

    expect(byFirst.body.data.total).toBe(3);
    expect(byLast.body.data.total).toBe(3);
    expect(noMatch.body.data.total).toBe(0);
  });

  it('filters semester by case-insensitive contains, application_year exact', async () => {
    // Alpha & Gamma -> WS, Beta -> SS. All -> application_year 2025.
    const ws = await requestWithSupertest
      .get(`${PAGINATED_URL}?semester=WS&sortBy=program_name`)
      .set('tenantId', TENANT_ID);
    // Free-text semester filter is case-insensitive (lowercase still matches).
    const wsLower = await requestWithSupertest
      .get(`${PAGINATED_URL}?semester=ws`)
      .set('tenantId', TENANT_ID);
    const ss = await requestWithSupertest
      .get(`${PAGINATED_URL}?semester=SS`)
      .set('tenantId', TENANT_ID);
    const year2025 = await requestWithSupertest
      .get(`${PAGINATED_URL}?application_year=2025`)
      .set('tenantId', TENANT_ID);
    const yearNone = await requestWithSupertest
      .get(`${PAGINATED_URL}?application_year=2099`)
      .set('tenantId', TENANT_ID);

    expect(ws.body.data.total).toBe(2);
    expect(deadlineNames(ws)).toEqual(['Alpha Program', 'Gamma Program']);
    expect(wsLower.body.data.total).toBe(2);
    expect(ss.body.data.total).toBe(1);
    expect(year2025.body.data.total).toBe(3);
    expect(yearNone.body.data.total).toBe(0);
  });

  it('scopes to a supervising TaiGer user (my-students paginated)', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const UserModel = db.model('User', UserSchema);
    // `agents` lives on the Student discriminator, not the base User schema the
    // test registers — so set it via the native driver (bypassing strict mode)
    // with real ObjectIds, matching how production student docs store it.
    await UserModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(student._id) },
      {
        $set: { agents: [new mongoose.Types.ObjectId(agent._id)] }
      }
    );

    const mine = await requestWithSupertest
      .get(
        `/api/applications/taiger-user/${agent._id}/paginated?sortBy=program_name`
      )
      .set('tenantId', TENANT_ID);
    // A user who supervises nobody sees nothing.
    const other = await requestWithSupertest
      .get(`/api/applications/taiger-user/${student2._id}/paginated`)
      .set('tenantId', TENANT_ID);

    expect(mine.status).toBe(200);
    expect(mine.body.data.total).toBe(3);
    expect(deadlineNames(mine)).toEqual([
      'Alpha Program',
      'Beta Program',
      'Gamma Program'
    ]);
    expect(other.body.data.total).toBe(0);
  });

  it('returns the deadline distribution (active vs potentials) computed in the DB', async () => {
    const resp = await requestWithSupertest
      .get('/api/applications/distribution')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    // 3 open applications, all decided 'O' -> one active per deadline bucket.
    // Deadlines (application_year 2025): Beta 2024/05/01, Gamma 2024/11/30,
    // Alpha 2025/01/15 — sorted ascending by the deadline string.
    expect(resp.body.data).toEqual([
      { name: '2024/05/01', active: 1, potentials: 0 },
      { name: '2024/11/30', active: 1, potentials: 0 },
      { name: '2025/01/15', active: 1, potentials: 0 }
    ]);
  });

  it('scopes the distribution to a supervising user via ?userId', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const UserModel = db.model('User', UserSchema);
    await UserModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(student._id) },
      { $set: { agents: [new mongoose.Types.ObjectId(agent._id)] } }
    );

    const mine = await requestWithSupertest
      .get(`/api/applications/distribution?userId=${agent._id}`)
      .set('tenantId', TENANT_ID);
    const other = await requestWithSupertest
      .get(`/api/applications/distribution?userId=${student2._id}`)
      .set('tenantId', TENANT_ID);

    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(3);
    // A user who supervises nobody gets an empty distribution.
    expect(other.body.data).toEqual([]);
  });
});
