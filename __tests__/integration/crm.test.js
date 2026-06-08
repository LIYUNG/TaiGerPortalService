// Full-stack integration layer for the CRM routes:
//   supertest -> real router -> real controllers/crm -> Drizzle query builder.
//
// CRM is a Postgres/Drizzle feature with no Mongo service layer — the controller
// talks to the ORM directly. There is no real Postgres in the test environment,
// so the ORM is the boundary we stub: a chainable/awaitable Drizzle double that
// resolves to controllable fixtures. Everything ABOVE the ORM (routing, auth and
// permission wiring, request/response shaping, status mapping) runs for real.
// The exhaustive per-endpoint HTTP behaviour lives in ../controllers/crm.test.js
// (boundary mocked tightly). Kept thin here: the critical happy/empty paths.

// ── Mock declarations (must be at top, before any require()) ─────────────────

jest.mock('../../database', () => {
  // Drizzle builders are simultaneously chainable AND awaitable (thenable).
  // The shared builder resolves to state.selectResult when awaited; each
  // chainable method returns the same builder so any chain length works.
  // `returning()` resolves to the insert/update payload.
  const state = {
    selectResult: [],
    insertResult: [{ id: 1, userId: 'test-user' }]
  };

  const builder = {};
  builder.then = (resolve, reject) =>
    Promise.resolve(state.selectResult).then(resolve, reject);
  builder.catch = (cb) => Promise.resolve(state.selectResult).catch(cb);
  builder.finally = (cb) => Promise.resolve(state.selectResult).finally(cb);

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
    'set',
    'delete',
    'onConflictDoNothing',
    'onConflictDoUpdate'
  ];
  chainMethods.forEach((m) => {
    builder[m] = jest.fn().mockReturnValue(builder);
  });

  builder.returning = jest
    .fn()
    .mockImplementation(() => Promise.resolve(state.insertResult));

  const $with = jest.fn().mockReturnValue({
    as: jest.fn().mockReturnValue({})
  });

  const mockPostgresDb = {
    ...builder,
    $with,
    transaction: jest.fn(async (callback) => callback(mockPostgresDb)),
    with: jest.fn().mockReturnValue(builder),
    execute: jest.fn().mockResolvedValue([]),
    query: {
      leads: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    },
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

  const connections = {};
  const connectToDatabase = jest.fn().mockImplementation((tenantId) => {
    if (connections[tenantId]) return connections[tenantId];
    const mongoose = require('mongoose');
    const conn = mongoose.connection.useDb
      ? mongoose.connection.useDb(tenantId, { useCache: true })
      : mongoose.connection;

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

    reg('User', UserSchema);
    try {
      conn.model('User').discriminator('Agent', Agent.schema);
      conn.model('User').discriminator('Editor', Editor.schema);
      conn.model('User').discriminator('Student', Student.schema);
      conn.model('User').discriminator('Admin', Admin.schema);
      conn.model('User').discriminator('External', External.schema);
      conn.model('User').discriminator('Guest', Guest.schema);
    } catch (_) {}

    connections[tenantId] = conn;
    return conn;
  });

  const disconnectFromDatabase = jest
    .fn()
    .mockImplementation(async (tenant) => {
      delete connections[tenant];
    });

  return {
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
    .mockResolvedValue({ success: true, meetingId: 'meet-123' }),
  scheduleInviteTA: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn()
  }
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
const { User: DefaultUserModel } = require('../../models');
const { protect } = require('../../middlewares/auth');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { disconnectFromDatabase, getPostgresDb } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, student } = require('../mock/user');
const postgres = getPostgresDb();

const requestWithSupertest = request(app);

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  postgres._resetState();

  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  await UserModel.deleteMany();
  await UserModel.insertMany(users);

  await DefaultUserModel.deleteMany();
  await DefaultUserModel.insertMany(users);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/crm/leads (full stack)', () => {
  it('returns all leads as a success array', async () => {
    postgres._setSelectResult([{ id: 'l1', fullName: 'A' }]);
    const resp = await requestWithSupertest
      .get('/api/crm/leads')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/crm/leads/:leadId (full stack)', () => {
  it('returns 200 with data:null when the lead does not exist', async () => {
    const leadId = new ObjectId().toHexString();
    postgres.query.leads.findFirst.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/crm/leads/${leadId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeNull();
  });
});

describe('PUT /api/crm/leads/:leadId (full stack)', () => {
  it('updates a lead and returns 200', async () => {
    const leadId = new ObjectId().toHexString();
    postgres._setInsertResult([{ id: leadId, status: 'contacted' }]);

    const resp = await requestWithSupertest
      .put(`/api/crm/leads/${leadId}`)
      .set('tenantId', TENANT_ID)
      .send({ status: 'contacted' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /api/crm/students/:studentId/lead (full stack)', () => {
  it('creates a lead from an existing student and returns 201', async () => {
    const { _id: studentId } = student;
    postgres._setInsertResult([{ id: 1, fullName: 'TestStudent' }]);

    const resp = await requestWithSupertest
      .post(`/api/crm/students/${studentId}/lead`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
  });
});

describe('GET /api/crm/students/:studentId/lead (full stack)', () => {
  it('returns 404 when the student has no lead', async () => {
    const { _id: studentId } = student;
    postgres.query.leads.findFirst.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/crm/students/${studentId}/lead`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});

describe('GET /api/crm/meetings (full stack)', () => {
  it('returns all meetings as a success array', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/meetings')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/crm/meetings/:meetingId (full stack)', () => {
  it('returns 404 when the meeting does not exist', async () => {
    const meetingId = new ObjectId().toHexString();
    const resp = await requestWithSupertest
      .get(`/api/crm/meetings/${meetingId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});

describe('PUT /api/crm/meetings/:meetingId (full stack)', () => {
  it('updates a meeting and returns 200', async () => {
    const meetingId = new ObjectId().toHexString();
    postgres._setInsertResult([{ id: meetingId, title: 'Updated meeting' }]);

    const resp = await requestWithSupertest
      .put(`/api/crm/meetings/${meetingId}`)
      .set('tenantId', TENANT_ID)
      .send({ title: 'Updated meeting' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('GET /api/crm/stats (full stack)', () => {
  it('returns CRM stats with 200', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/stats')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
  });
});

describe('GET /api/crm/sales-reps (full stack)', () => {
  it('returns all sales reps as a success array', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/sales-reps')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/crm/deals (full stack)', () => {
  it('returns all deals as a success array', async () => {
    const resp = await requestWithSupertest
      .get('/api/crm/deals')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('POST /api/crm/deals (full stack)', () => {
  it('creates a deal and returns 201', async () => {
    postgres._setInsertResult([
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

describe('PUT /api/crm/deals/:dealId (full stack)', () => {
  it('updates a deal and returns 200', async () => {
    const dealId = new ObjectId().toHexString();
    postgres._setInsertResult([{ id: dealId, status: 'signed' }]);

    const resp = await requestWithSupertest
      .put(`/api/crm/deals/${dealId}`)
      .set('tenantId', TENANT_ID)
      .send({ status: 'signed' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('POST /api/crm/instant-invite (full stack)', () => {
  it('calls the meeting assistant and returns 200', async () => {
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
