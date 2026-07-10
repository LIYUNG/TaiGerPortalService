// Integration layer for the CRM routes — HTTP boundary down to the controller,
// DATABASE-FREE:
//   supertest -> real router -> real controllers/crm -> Drizzle query builder.
//
// CRM is a Postgres/Drizzle feature: the controller talks to the ORM directly.
// There is no real Postgres in the test environment, so the ORM is the boundary
// we stub — a chainable/awaitable Drizzle double that resolves to controllable
// fixtures (`jest.mock('../../database')`). The one place CRM touches Mongo is
// `UserService.getUserById` (creating a lead from a student); that goes through
// the mocked UserDAO. Everything ABOVE the data layer (routing, auth/permission
// wiring, request/response shaping, status mapping) runs for real. No real or
// in-memory database is used.

// ── Mock declarations (must be at top, before any require()) ─────────────────

jest.mock('../../database', () => {
  // Drizzle builders are simultaneously chainable AND awaitable (thenable).
  // The shared builder resolves to state.selectResult when awaited; each
  // chainable method returns the same builder so any chain length works.
  // `returning()` resolves to the insert/update payload.
  const state: { selectResult: unknown[]; insertResult: unknown[] } = {
    selectResult: [],
    insertResult: [{ id: 1, userId: 'test-user' }]
  };

  const builder: Record<string, unknown> = {};
  builder.then = (
    resolve: (value: unknown) => void,
    reject: (reason?: unknown) => void
  ) => Promise.resolve(state.selectResult).then(resolve, reject);
  builder.catch = (cb: (reason?: unknown) => void) =>
    Promise.resolve(state.selectResult).catch(cb);
  builder.finally = (cb: () => void) =>
    Promise.resolve(state.selectResult).finally(cb);

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

  const mockPostgresDb: Record<string, unknown> = {
    ...builder,
    $with,
    transaction: jest.fn(async (callback: (db: unknown) => unknown) =>
      callback(mockPostgresDb)
    ),
    with: jest.fn().mockReturnValue(builder),
    execute: jest.fn().mockResolvedValue([]),
    query: {
      leads: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    },
    _setSelectResult: (v: unknown[]) => {
      state.selectResult = v;
    },
    _setInsertResult: (v: unknown[]) => {
      state.insertResult = v;
    },
    _resetState: () => {
      state.selectResult = [];
      state.insertResult = [{ id: 1, userId: 'test-user' }];
    }
  };

  return {
    getPostgresDb: jest.fn(() => mockPostgresDb),
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
  auditLog: (req: Request, res: Response, next: NextFunction) => next()
}));

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);

// The single Mongo touchpoint in CRM: creating a lead from a student resolves
// the student through UserService -> UserDAO.getUserById.
jest.mock('../../dao/user.dao');

// ── Imports ───────────────────────────────────────────────────────────────────

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
const { ObjectId } = require('mongoose').Types;

import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { getPostgresDb } from '../../database';
import UserDAOModule from '../../dao/user.dao';
import { TENANT_ID } from '../fixtures/constants';
import { admin, student } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()` calls type-check.
type MockedDAO = Record<string, jest.Mock>;
const UserDAO = UserDAOModule as unknown as MockedDAO;

// getPostgresDb() is fully replaced by the jest.mock('../../database') factory
// above; re-type the returned double as a bag of jest.Mock methods plus the
// test-only `_setSelectResult`/`_setInsertResult`/`_resetState` helpers.
type MockedPostgresDb = Record<string, jest.Mock> & {
  query: { leads: { findFirst: jest.Mock } };
  _setSelectResult: (v: unknown[]) => void;
  _setInsertResult: (v: unknown[]) => void;
  _resetState: () => void;
};
const postgres = getPostgresDb() as unknown as MockedPostgresDb;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  postgres._resetState();
  postgres.query.leads.findFirst.mockResolvedValue(null);

  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
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
    // The student is resolved from Mongo through the mocked UserDAO.
    UserDAO.getUserById.mockResolvedValue({
      _id: studentId,
      firstname_chinese: 'Test',
      lastname_chinese: 'Student'
    });
    postgres._setInsertResult([{ id: 1, fullName: 'TestStudent' }]);

    const resp = await requestWithSupertest
      .post(`/api/crm/students/${studentId}/lead`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
    expect(UserDAO.getUserById).toHaveBeenCalledWith(studentId.toString());
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
