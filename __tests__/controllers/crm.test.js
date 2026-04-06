// ── Mock declarations (must be at top, before any require()) ─────────────────

jest.mock('../../database', () => {
  // ---------------------------------------------------------------------------
  // Drizzle query builder mock
  // ---------------------------------------------------------------------------
  // Drizzle builders are simultaneously chainable AND awaitable (thenable).
  // For example:
  //   await db.select().from(t)                  -- from() is the terminal
  //   await db.select().from(t).where(eq(...))   -- where() is the terminal
  //   await db.update(t).set({}).where().returning() -- returning() is terminal
  //
  // We model this by making the shared builder object itself a thenable that
  // resolves to `[]` by default. Each chainable method returns the same
  // builder, so the "last" awaited method in any chain resolves correctly.
  // `returning()` is special: it must resolve to the insert payload, so it
  // returns its own dedicated Promise rather than the shared builder.
  // ---------------------------------------------------------------------------

  // Mutable defaults that individual tests can adjust via mockPostgresDb helpers
  const state = {
    selectResult: [],
    insertResult: [{ id: 1, userId: 'test-user' }]
  };

  // The shared thenable builder
  const builder = {};

  // Thenable protocol — resolves to state.selectResult when awaited
  builder.then = (resolve, reject) =>
    Promise.resolve(state.selectResult).then(resolve, reject);
  builder.catch = (cb) => Promise.resolve(state.selectResult).catch(cb);
  builder.finally = (cb) => Promise.resolve(state.selectResult).finally(cb);

  // Chainable methods — all return `builder` so any chain length works
  const chainMethods = [
    'select',
    'from',
    'where',
    'leftJoin',
    'orderBy',
    'limit',
    'groupBy',
    'insert',
    'values',
    'update',
    'set'
  ];
  chainMethods.forEach((m) => {
    builder[m] = jest.fn().mockReturnValue(builder);
  });

  // `returning` is terminal for insert/update — returns a dedicated Promise
  builder.returning = jest
    .fn()
    .mockImplementation(() => Promise.resolve(state.insertResult));

  // postgresDb.$with(cte) returns a CTE placeholder
  const $with = jest.fn().mockReturnValue({
    as: jest.fn().mockReturnValue({})
  });

  const mockPostgresDb = {
    ...builder,
    $with,
    // postgresDb.with(cteRef) starts a chain that resolves via builder
    with: jest.fn().mockReturnValue(builder),
    // query.leads.findFirst is used by getLead / getLeadByStudentId
    query: {
      leads: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    },
    // Test helpers to override resolved values
    _setSelectResult: (v) => {
      state.selectResult = v;
    },
    _setInsertResult: (v) => {
      state.insertResult = v;
    },
    _resetState: () => {
      state.selectResult = [];
      state.insertResult = [{ id: 1, userId: 'test-user' }];
    }
  };

  // ---------------------------------------------------------------------------
  // connectToDatabase — returns a real Mongoose tenant connection with all
  // models registered, so req.db.model('VC') etc. work in the app layer.
  // We cannot use jest.requireActual('../../database') because database.js
  // instantiates a real Drizzle/Neon connection at module load time, which
  // fails without a valid Postgres URI.
  // ---------------------------------------------------------------------------
  const connections = {};
  const connectToDatabase = jest.fn().mockImplementation((tenantId) => {
    if (connections[tenantId]) return connections[tenantId];
    const mongoose = require('mongoose');
    const conn = mongoose.connection.useDb
      ? mongoose.connection.useDb(tenantId, { useCache: true })
      : mongoose.connection;

    // Helper: register model only if not already registered
    const reg = (name, schema) => {
      try {
        return conn.model(name);
      } catch (_) {
        return conn.model(name, schema);
      }
    };

    const {
      UserSchema,
      Agent,
      Editor,
      Student,
      Admin,
      External,
      Guest
    } = require('../../models/User');
    const { applicationSchema } = require('../../models/Application');
    const { EventSchema } = require('@taiger-common/model');
    const { documentThreadsSchema } = require('../../models/Documentthread');
    const { programSchema } = require('../../models/Program');
    const { versionControlSchema } = require('../../models/VersionControl');
    const {
      programChangeRequestSchema
    } = require('../../models/ProgramChangeRequest');
    const { surveyInputSchema } = require('../../models/SurveyInput');
    const { ticketSchema } = require('../../models/Ticket');
    const { communicationsSchema } = require('../../models/Communication');
    const { documentationsSchema } = require('../../models/Documentation');
    const { internaldocsSchema } = require('../../models/Internaldoc');
    const { notesSchema } = require('../../models/Note');
    const { complaintSchema } = require('../../models/Complaint');
    const { coursesSchema } = require('../../models/Course');
    const { tokenSchema } = require('../../models/Token');
    const { allCourseSchema } = require('../../models/Allcourse');
    const { expensesSchema } = require('../../models/Expense');
    const { incomesSchema } = require('../../models/Income');
    const { interviewsSchema } = require('../../models/Interview');
    const { intervalSchema } = require('../../models/Interval');
    const {
      interviewSurveyResponseSchema
    } = require('../../models/InterviewSurveyResponse');
    const { userlogSchema } = require('../../models/Userlog');
    const { ResponseTimeSchema } = require('../../models/ResponseTime');
    const { permissionSchema } = require('../../models/Permission');
    const { keywordSetSchema } = require('../../models/Keywordset');
    const {
      programRequirementSchema
    } = require('../../models/Programrequirement');
    const { auditSchema } = require('../../models/Audit');
    const {
      basedocumentationslinksSchema
    } = require('../../models/Basedocumentationslink');
    const { docspagesSchema } = require('../../models/Docspage');
    const { templatesSchema } = require('../../models/Template');

    reg('User', UserSchema);
    try {
      conn.model('User').discriminator('Agent', Agent.schema);
      conn.model('User').discriminator('Editor', Editor.schema);
      conn.model('User').discriminator('Student', Student.schema);
      conn.model('User').discriminator('Admin', Admin.schema);
      conn.model('User').discriminator('External', External.schema);
      conn.model('User').discriminator('Guest', Guest.schema);
    } catch (_) {}

    reg('Application', applicationSchema);
    reg('Allcourse', allCourseSchema);
    reg('Audit', auditSchema);
    reg('Basedocumentationslink', basedocumentationslinksSchema);
    reg('Communication', communicationsSchema);
    reg('Complaint', complaintSchema);
    reg('Course', coursesSchema);
    reg('Documentation', documentationsSchema);
    reg('Documentthread', documentThreadsSchema);
    reg('Docspage', docspagesSchema);
    reg('Event', EventSchema);
    reg('Expense', expensesSchema);
    reg('Incom', incomesSchema);
    reg('Internaldoc', internaldocsSchema);
    reg('Interval', intervalSchema);
    reg('Interview', interviewsSchema);
    reg('InterviewSurveyResponse', interviewSurveyResponseSchema);
    reg('KeywordSet', keywordSetSchema);
    reg('Note', notesSchema);
    reg('Permission', permissionSchema);
    reg('ProgramRequirement', programRequirementSchema);
    reg('ResponseTime', ResponseTimeSchema);
    reg('surveyInput', surveyInputSchema);
    reg('Template', templatesSchema);
    reg('Ticket', ticketSchema);
    reg('Token', tokenSchema);
    reg('VC', versionControlSchema);
    reg('ProgramChangeRequest', programChangeRequestSchema);
    reg('Program', programSchema);
    reg('Userlog', userlogSchema);

    connections[tenantId] = conn;
    return conn;
  });

  const disconnectFromDatabase = jest
    .fn()
    .mockImplementation(async (tenant) => {
      delete connections[tenant];
    });

  return {
    postgresDb: mockPostgresDb,
    getPostgresDb: jest.fn(() => mockPostgresDb),
    connectToDatabase,
    disconnectFromDatabase,
    connections,
    mongoDb: jest.fn().mockReturnValue('mongodb://localhost:27017/test'),
    tenantDb: 'Tenant'
  };
});

jest.mock('../../utils/meeting-assistant.service', () => ({
  instantInviteTA: jest
    .fn()
    .mockResolvedValue({ success: true, meetingId: 'meet-123' })
}));

jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn()
  }
}));

jest.mock('../../utils/log/log', () => ({
  logAccess: (req, res, next) => next()
}));

jest.mock('../../utils/log/auditLog', () => ({
  auditLog: (req, res, next) => next()
}));

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

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

// ── Imports ───────────────────────────────────────────────────────────────────

const request = require('supertest');
const { ObjectId } = require('mongoose').Types;

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { disconnectFromDatabase, postgresDb } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, student } = require('../mock/user');

const requestWithSupertest = request(app);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  postgresDb._resetState();

  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/crm/leads', () => {
  it('should return all leads', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/leads')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/crm/leads/:leadId', () => {
  it('should return 200 when lead does not exist', async () => {
    const leadId = new ObjectId().toHexString();
    postgresDb.query.leads.findFirst.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/crm/leads/${leadId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('PUT /api/crm/leads/:leadId', () => {
  it('should update a lead and return 200', async () => {
    const leadId = new ObjectId().toHexString();
    postgresDb._setInsertResult([{ id: leadId, status: 'contacted' }]);

    const resp = await requestWithSupertest
      .put(`/api/crm/leads/${leadId}`)
      .set('tenantId', TENANT_ID)
      .send({ status: 'contacted' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /api/crm/students/:studentId/lead', () => {
  it('should create a lead from an existing student and return 201', async () => {
    const { _id: studentId } = student;
    // The postgres insert.values().returning() resolves to the new lead
    postgresDb._setInsertResult([{ id: 1, fullName: 'TestStudent' }]);

    const resp = await requestWithSupertest
      .post(`/api/crm/students/${studentId}/lead`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
  });
});

describe('GET /api/crm/students/:studentId/lead', () => {
  it('should return 404 when student has no lead', async () => {
    const { _id: studentId } = student;
    postgresDb.query.leads.findFirst.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/crm/students/${studentId}/lead`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});

describe('GET /api/crm/meetings', () => {
  it('should return all meetings', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/meetings')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/crm/meetings/:meetingId', () => {
  it('should return 404 when meeting does not exist', async () => {
    const meetingId = new ObjectId().toHexString();
    // limit() resolves to [] via builder.then — no meeting found

    const resp = await requestWithSupertest
      .get(`/api/crm/meetings/${meetingId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});

describe('PUT /api/crm/meetings/:meetingId', () => {
  it('should update a meeting and return 200', async () => {
    const meetingId = new ObjectId().toHexString();
    postgresDb._setInsertResult([{ id: meetingId, title: 'Updated meeting' }]);

    const resp = await requestWithSupertest
      .put(`/api/crm/meetings/${meetingId}`)
      .set('tenantId', TENANT_ID)
      .send({ title: 'Updated meeting' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('GET /api/crm/stats', () => {
  it('should return CRM stats with 200', async () => {
    // getCRMStats awaits multiple postgres queries all resolving to [] via builder
    const resp = await requestWithSupertest
      .get('/api/crm/stats')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
  });
});

describe('GET /api/crm/sales-reps', () => {
  it('should return all sales reps', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/sales-reps')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/crm/deals', () => {
  it('should return all deals', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/deals')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('POST /api/crm/deals', () => {
  it('should create a deal and return 201', async () => {
    postgresDb._setInsertResult([
      { id: 1, leadId: 'lead-1', salesUserId: 'user-1', status: 'initiated' }
    ]);

    const resp = await requestWithSupertest
      .post('/api/crm/deals')
      .set('tenantId', TENANT_ID)
      .send({ leadId: 'lead-1', salesUserId: 'user-1' });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
  });
});

describe('PUT /api/crm/deals/:dealId', () => {
  it('should update a deal and return 200', async () => {
    const dealId = new ObjectId().toHexString();
    postgresDb._setInsertResult([{ id: dealId, status: 'signed' }]);

    const resp = await requestWithSupertest
      .put(`/api/crm/deals/${dealId}`)
      .set('tenantId', TENANT_ID)
      .send({ status: 'signed' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /api/crm/instant-invite', () => {
  it('should call meeting assistant and return 200', async () => {
    const resp = await requestWithSupertest
      .post('/api/crm/instant-invite')
      .set('tenantId', TENANT_ID)
      .send({
        meetingSummary: 'Intro call with candidate',
        meetingLink: 'https://meet.example.com/abc123'
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.meetingId).toBe('meet-123');
  });
});
