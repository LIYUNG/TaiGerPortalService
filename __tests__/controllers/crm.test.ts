// Controller UNIT test for controllers/crm.
//
// CRM is a proxy/lambda-style controller: there is NO Mongo service layer — the
// controller talks to the Postgres/Drizzle ORM and the meeting-assistant client
// directly. So the "service" we isolate is that BOUNDARY: we mock the Drizzle
// query builder (../../database -> getPostgresDb), the meeting-assistant client
// and the single UserService call, then call each handler DIRECTLY as a
// (req, res, next) function. We assert ONLY the controller's own work:
//   - the status code + body it writes to res (incl. 400 validation, 404),
//   - the args it forwards to the boundary (e.g. instantInviteTA, getUserById),
//   - that a boundary error is forwarded to next().
// No route, no supertest, no middleware. The route-level wiring is covered by
// __tests__/integration/crm.test.js.
//
// The DB mock must be declared before the controller is required, because the
// controller calls getPostgresDb() at module-evaluation time.

jest.mock('../../database', () => {
  // A chainable + awaitable Drizzle double. `_setSelect` controls what an
  // awaited select chain resolves to; `_setReturning` controls insert/update
  // .returning().
  const state: { selectResult: unknown; returningResult: unknown[] } = {
    selectResult: [],
    returningResult: []
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

  [
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
  ].forEach((m) => {
    builder[m] = jest.fn().mockReturnValue(builder);
  });
  builder.returning = jest
    .fn()
    .mockImplementation(() => Promise.resolve(state.returningResult));

  const mockPostgresDb: Record<string, unknown> = {
    ...builder,
    $with: jest.fn().mockReturnValue({ as: jest.fn().mockReturnValue({}) }),
    with: jest.fn().mockReturnValue(builder),
    transaction: jest.fn(async (cb: (db: unknown) => unknown) =>
      cb(mockPostgresDb)
    ),
    execute: jest.fn().mockResolvedValue([]),
    query: { leads: { findFirst: jest.fn().mockResolvedValue(null) } },
    _setSelect: (v: unknown) => {
      state.selectResult = v;
    },
    _setReturning: (v: unknown[]) => {
      state.returningResult = v;
    },
    _reset: () => {
      state.selectResult = [];
      state.returningResult = [];
    }
  };

  return {
    getPostgresDb: jest.fn(() => mockPostgresDb),
    connections: {},
    mongoDb: jest.fn().mockReturnValue('mongodb://localhost:27017/test'),
    tenantDb: 'Tenant'
  };
});

jest.mock('../../services/users');
jest.mock('../../utils/meeting-assistant.service', () => ({
  instantInviteTA: jest.fn(),
  scheduleInviteTA: jest.fn().mockResolvedValue({ success: true })
}));
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    flushAll: jest.fn()
  }
}));

const { ObjectId } = require('mongoose').Types;
import type { Request, Response, NextFunction } from 'express';
import { getPostgresDb } from '../../database';
import UserServiceModule from '../../services/users';
import { instantInviteTA } from '../../utils/meeting-assistant.service';
import crmControllerModule = require('../../controllers/crm');
const { mockReq, mockRes } = require('../helpers/httpMocks');
import { admin, student } from '../mock/user';

// Auto-mocked '../../services/users' exposes jest.fn()s at runtime, but TS
// still sees the real signatures; cast to a bag of jest.Mock methods so the
// per-test `.mockResolvedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const UserService = UserServiceModule as unknown as MockedModule;

// The '../../utils/meeting-assistant.service' factory mock above returns
// jest.fn()s, but TS still sees the real `instantInviteTA` signature. `asMock`
// casts a binding to jest.Mock so `.mockResolvedValue()` type-checks.
const asMock = (fn: unknown) => fn as jest.Mock;

// getPostgresDb() is fully replaced by the jest.mock('../../database') factory
// above; re-type the returned double as a bag of jest.Mock methods plus the
// test-only `_setSelect`/`_setReturning`/`_reset` helpers (see
// __tests__/integration/crm.test.ts for the same pattern).
type MockedPostgresDb = Record<string, jest.Mock> & {
  query: { leads: { findFirst: jest.Mock } };
  _setSelect: (v: unknown) => void;
  _setReturning: (v: unknown[]) => void;
  _reset: () => void;
};
const postgres = getPostgresDb() as unknown as MockedPostgresDb;

// controllers/crm uses `export =`; the handlers are wrapped in asyncHandler,
// whose exposed type mirrors each wrapped function's own (req, res) parameter
// list. Tests call the handlers directly as (req, res, next), so re-type the
// module as a bag of full 3-arg handlers.
type Handler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;
const crmController = crmControllerModule as unknown as Record<string, Handler>;
const {
  getCRMStats,
  getLeads,
  getLead,
  getLeadByStudentId,
  createLeadFromStudent,
  updateLead,
  appendLeadTags,
  deleteLeadTags,
  createLeadNote,
  updateLeadNote,
  deleteLeadNote,
  getMeetings,
  getMeeting,
  updateMeeting,
  getSalesReps,
  getDeals,
  createDeal,
  updateDeal,
  instantInviteMeetingAssistant
} = crmController;

beforeEach(() => {
  jest.clearAllMocks();
  postgres._reset();
  postgres.query.leads.findFirst.mockResolvedValue(null);
});

describe('getLeads', () => {
  it('200: returns the leads the ORM resolves', async () => {
    postgres._setSelect([{ id: 'l1', fullName: 'Ann' }]);
    const res = mockRes();

    await getLeads(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'l1', fullName: 'Ann' }]
    });
  });

  it('forwards an ORM error to next()', async () => {
    const err = new Error('pg down');
    // Make the awaited select chain reject.
    postgres.orderBy.mockReturnValueOnce({
      then: (_res: (value: unknown) => void, rej: (reason?: unknown) => void) =>
        Promise.reject(err).then(_res, rej)
    });
    const next = jest.fn();

    await getLeads(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getLead', () => {
  it('200: returns the formatted lead when found', async () => {
    const leadId = new ObjectId().toHexString();
    postgres.query.leads.findFirst.mockResolvedValue({
      id: leadId,
      fullName: 'Ann',
      leadTags: [],
      leadNotes: [],
      meetingTranscripts: []
    });
    const res = mockRes();

    await getLead(mockReq({ params: { leadId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(leadId);
  });

  it('200: data is null when no lead is found', async () => {
    const leadId = new ObjectId().toHexString();
    postgres.query.leads.findFirst.mockResolvedValue(null);
    const res = mockRes();

    await getLead(mockReq({ params: { leadId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: null });
  });
});

describe('getLeadByStudentId', () => {
  it('200: returns the matched lead id', async () => {
    const studentId = new ObjectId().toHexString();
    postgres.query.leads.findFirst.mockResolvedValue({ id: 'lead-9' });
    const res = mockRes();

    await getLeadByStudentId(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { id: 'lead-9' }
    });
  });

  it('404: when the student has no matching lead', async () => {
    const studentId = new ObjectId().toHexString();
    postgres.query.leads.findFirst.mockResolvedValue(null);
    const res = mockRes();

    await getLeadByStudentId(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

describe('createLeadFromStudent', () => {
  it('201: looks the student up via UserService and creates the lead', async () => {
    const studentId = student._id.toString();
    UserService.getUserById.mockResolvedValue({
      _id: studentId,
      firstname_chinese: '三',
      lastname_chinese: '王'
    });
    postgres._setReturning([{ id: 7, fullName: '王三' }]);
    // The follow-up .update(...).set(...).where(...) resolves via the select
    // path (no .returning()); give it a rowCount via the awaitable chain.
    postgres._setSelect({ rowCount: 0 });
    const res = mockRes();

    await createLeadFromStudent(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(UserService.getUserById).toHaveBeenCalledWith(studentId);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 7, fullName: '王三' });
  });

  it('404: when the student does not exist (no insert)', async () => {
    const studentId = new ObjectId().toHexString();
    UserService.getUserById.mockResolvedValue(null);
    const res = mockRes();

    await createLeadFromStudent(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(postgres.insert).not.toHaveBeenCalled();
  });
});

describe('getMeeting', () => {
  it('200: returns the meeting when found', async () => {
    const meetingId = new ObjectId().toHexString();
    postgres._setSelect([{ id: meetingId, title: 'Intro' }]);
    const res = mockRes();

    await getMeeting(mockReq({ params: { meetingId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { id: meetingId, title: 'Intro' }
    });
  });

  it('404: when no meeting matches', async () => {
    const meetingId = new ObjectId().toHexString();
    postgres._setSelect([]);
    const res = mockRes();

    await getMeeting(mockReq({ params: { meetingId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

describe('createDeal', () => {
  it('201: creates the deal returned by the ORM', async () => {
    postgres._setReturning([{ id: 1, leadId: 'l1', status: 'initiated' }]);
    const res = mockRes();

    await createDeal(
      mockReq({ body: { leadId: 'l1', salesUserId: 'u1' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 1, leadId: 'l1', status: 'initiated' });
  });

  it('400: rejects when leadId or salesUserId is missing (no insert)', async () => {
    const res = mockRes();

    await createDeal(mockReq({ body: { leadId: 'l1' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(postgres.insert).not.toHaveBeenCalled();
  });
});

describe('updateDeal', () => {
  it('200: returns the updated deal', async () => {
    const dealId = new ObjectId().toHexString();
    postgres._setReturning([{ id: dealId, status: 'signed' }]);
    const res = mockRes();

    await updateDeal(
      mockReq({ params: { dealId }, body: { status: 'signed' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: dealId, status: 'signed' });
  });

  it('404: when no deal matches the id', async () => {
    const dealId = new ObjectId().toHexString();
    postgres._setReturning([]);
    const res = mockRes();

    await updateDeal(
      mockReq({ params: { dealId }, body: { status: 'signed' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('instantInviteMeetingAssistant', () => {
  it('200: forwards summary + link to the meeting assistant on success', async () => {
    asMock(instantInviteTA).mockResolvedValue({
      success: true,
      meetingId: 'm-1'
    });
    const res = mockRes();

    await instantInviteMeetingAssistant(
      mockReq({
        body: { meetingSummary: 'Intro', meetingLink: 'https://x/y' }
      }),
      res,
      jest.fn()
    );

    expect(instantInviteTA).toHaveBeenCalledWith('Intro', 'https://x/y');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, meetingId: 'm-1' });
  });

  it('400: when summary or link is missing (no client call)', async () => {
    const res = mockRes();

    await instantInviteMeetingAssistant(
      mockReq({ body: { meetingSummary: 'Intro' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(instantInviteTA).not.toHaveBeenCalled();
  });

  it('500: when the meeting assistant reports failure', async () => {
    asMock(instantInviteTA).mockResolvedValue({ success: false });
    const res = mockRes();

    await instantInviteMeetingAssistant(
      mockReq({
        body: { meetingSummary: 'Intro', meetingLink: 'https://x/y' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getCRMStats', () => {
  it('200: aggregates the ORM results into the stats body', async () => {
    // Every awaited select chain resolves to the same `selectResult`. A single
    // row carrying all the count/percentile fields satisfies every aggregate.
    postgres._setSelect([
      {
        totalCount: 5,
        recentCount: 2,
        convertedCount: 3,
        avgResponseTimeDays: 1.234,
        p50ResponseTimeDays: 1,
        p95ResponseTimeDays: 2,
        avgSalesCycle: 10.5,
        p50SalesCycle: 9,
        p95SalesCycle: 12,
        count: 4
      }
    ]);
    const res = mockRes();

    await getCRMStats(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totalLeadCount).toBe(5);
    expect(body.data.avgResponseTimeDays).toBe(1.23);
    expect(body.data.avgSalesCycleDays).toBe(10.5);
  });

  it('200: serves the cached value on a cache hit (no ORM work)', async () => {
    const { ten_minutes_cache } = require('../../cache/node-cache');
    ten_minutes_cache.get.mockReturnValueOnce({ success: true, cached: true });
    const res = mockRes();

    await getCRMStats(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, cached: true });
    expect(postgres.select).not.toHaveBeenCalled();
  });
});

describe('getMeetings', () => {
  it('200: returns the meeting summaries the ORM resolves', async () => {
    postgres._setSelect([{ id: 'm1', title: 'Intro', leadFullName: 'Ann' }]);
    const res = mockRes();

    await getMeetings(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'm1', title: 'Intro', leadFullName: 'Ann' }]
    });
  });
});

describe('getSalesReps', () => {
  it('200: returns the sales reps list', async () => {
    postgres._setSelect([{ userId: 'u1', label: 'Rep A' }]);
    const res = mockRes();

    await getSalesReps(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ userId: 'u1', label: 'Rep A' }]
    });
  });
});

describe('getDeals', () => {
  it('200: returns the joined deals list', async () => {
    postgres._setSelect([{ id: 'd1', leadFullName: 'Ann', salesLabel: 'Rep' }]);
    const res = mockRes();

    await getDeals(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

describe('updateMeeting', () => {
  it('200: returns the updated meeting', async () => {
    const meetingId = new ObjectId().toHexString();
    postgres._setReturning([{ id: meetingId, title: 'Updated' }]);
    const res = mockRes();

    await updateMeeting(
      mockReq({ params: { meetingId }, body: { title: 'Updated' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data).toEqual({
      id: meetingId,
      title: 'Updated'
    });
  });

  it('400: when meetingId is missing', async () => {
    const res = mockRes();
    await updateMeeting(mockReq({ body: { title: 'x' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400: when the update body is empty', async () => {
    const res = mockRes();
    await updateMeeting(
      mockReq({ params: { meetingId: 'm1' }, body: {} }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('404: when no meeting matches', async () => {
    postgres._setReturning([]);
    const res = mockRes();
    await updateMeeting(
      mockReq({ params: { meetingId: 'm1' }, body: { title: 'x' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('updateLead', () => {
  it('400: when leadId is missing', async () => {
    const res = mockRes();
    await updateLead(mockReq({ body: { status: 'open' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400: when the update body is empty', async () => {
    const res = mockRes();
    await updateLead(
      mockReq({ params: { leadId: 'l1' }, body: {} }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('200: updates core + additional fields, tags and notes, then re-reads', async () => {
    const leadId = new ObjectId().toHexString();
    // The transaction callback runs against the same builder; the lead update
    // .returning() yields the updated row.
    postgres._setReturning([{ id: leadId, status: 'won' }]);
    postgres.query.leads.findFirst.mockResolvedValue({
      id: leadId,
      status: 'won',
      leadTags: [],
      leadNotes: [],
      meetingTranscripts: []
    });
    const res = mockRes();

    await updateLead(
      mockReq({
        user: admin,
        params: { leadId },
        body: {
          status: 'won',
          bachelorGPA: '3.8',
          tags: ['vip', 'vip'],
          notes: ['call back']
        }
      }),
      res,
      jest.fn()
    );

    expect(postgres.transaction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data.id).toBe(leadId);
  });

  it('404: when the lead does not exist after the transaction', async () => {
    const leadId = new ObjectId().toHexString();
    // No lead update returned and the in-transaction refresh select is empty.
    postgres._setReturning([]);
    postgres._setSelect([]);
    const res = mockRes();

    await updateLead(
      mockReq({
        user: admin,
        params: { leadId },
        body: { status: 'won' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('lead tags', () => {
  const leadId = new ObjectId().toHexString();

  describe('appendLeadTags', () => {
    it('400: when tags are not provided', async () => {
      const res = mockRes();
      await appendLeadTags(
        mockReq({ params: { leadId }, body: {} }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('200: appends the tags and returns the full list', async () => {
      postgres._setSelect([{ id: 't1', tag: 'a' }]);
      const res = mockRes();
      await appendLeadTags(
        mockReq({ user: admin, params: { leadId }, body: { tags: ['a'] } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteLeadTags', () => {
    it('400: when leadId is missing', async () => {
      const res = mockRes();
      await deleteLeadTags(
        mockReq({ params: {}, body: { tag: 'a' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('200: deletes by a single tagId', async () => {
      postgres._setSelect([{ id: leadId }]); // exists
      const res = mockRes();
      await deleteLeadTags(
        mockReq({ params: { leadId }, body: { tagId: 'tid-1' } }),
        res,
        jest.fn()
      );
      expect(postgres.execute).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send.mock.calls[0][0].data).toEqual(['tid-1']);
    });

    it('200: deletes by multiple tagIds', async () => {
      postgres._setSelect([{ id: leadId }]);
      const res = mockRes();
      await deleteLeadTags(
        mockReq({ params: { leadId }, body: { tagIds: ['a', 'b'] } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send.mock.calls[0][0].data).toEqual(['a', 'b']);
    });

    it('200: deletes by tag name', async () => {
      postgres._setSelect([{ id: leadId }]);
      const res = mockRes();
      await deleteLeadTags(
        mockReq({ params: { leadId }, body: { tag: 'vip' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send.mock.calls[0][0].data).toEqual(['vip']);
    });

    it('400: when no tag/tagId is provided', async () => {
      postgres._setSelect([{ id: leadId }]);
      const res = mockRes();
      await deleteLeadTags(
        mockReq({ params: { leadId }, body: {} }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});

describe('lead notes', () => {
  const leadId = new ObjectId().toHexString();
  const noteId = new ObjectId().toHexString();

  describe('createLeadNote', () => {
    it('400: when the note is empty', async () => {
      const res = mockRes();
      await createLeadNote(
        mockReq({ params: { leadId }, body: { note: '   ' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('404: when the lead does not exist', async () => {
      postgres._setSelect([]);
      const res = mockRes();
      await createLeadNote(
        mockReq({ params: { leadId }, body: { note: 'hi' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('201: creates the note when the lead exists', async () => {
      postgres._setSelect([{ id: leadId }]); // exists
      postgres._setReturning([{ id: noteId, note: 'hi' }]);
      const res = mockRes();
      await createLeadNote(
        mockReq({ user: admin, params: { leadId }, body: { note: 'hi' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.send.mock.calls[0][0].data).toEqual([
        { id: noteId, note: 'hi' }
      ]);
    });
  });

  describe('updateLeadNote', () => {
    it('400: when ids are missing', async () => {
      const res = mockRes();
      await updateLeadNote(
        mockReq({ params: { leadId }, body: { note: 'x' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400: when the note is empty', async () => {
      const res = mockRes();
      await updateLeadNote(
        mockReq({ params: { leadId, noteId }, body: { note: '' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('200: returns the updated note', async () => {
      postgres._setReturning([{ id: noteId, note: 'updated' }]);
      const res = mockRes();
      await updateLeadNote(
        mockReq({ params: { leadId, noteId }, body: { note: 'updated' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('404: when the note is not found', async () => {
      postgres._setReturning([]);
      const res = mockRes();
      await updateLeadNote(
        mockReq({ params: { leadId, noteId }, body: { note: 'updated' } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteLeadNote', () => {
    it('400: when ids are missing', async () => {
      const res = mockRes();
      await deleteLeadNote(mockReq({ params: { leadId } }), res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('200: deletes the note', async () => {
      postgres._setReturning([{ id: noteId }]);
      const res = mockRes();
      await deleteLeadNote(
        mockReq({ params: { leadId, noteId } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send.mock.calls[0][0].data).toEqual({ id: noteId });
    });

    it('404: when the note is not found', async () => {
      postgres._setReturning([]);
      const res = mockRes();
      await deleteLeadNote(
        mockReq({ params: { leadId, noteId } }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});

// Validation / missing-id branches that were previously uncovered. Each handler
// short-circuits with a 400 before touching the ORM.
describe('missing-id validation branches', () => {
  it('getLead 400: when leadId is missing', async () => {
    const res = mockRes();
    await getLead(mockReq({ params: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getLeadByStudentId 400: when studentId is missing', async () => {
    const res = mockRes();
    await getLeadByStudentId(mockReq({ params: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createLeadFromStudent 400: when studentId is missing (no lookup)', async () => {
    const res = mockRes();
    await createLeadFromStudent(mockReq({ params: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(UserService.getUserById).not.toHaveBeenCalled();
  });

  it('appendLeadTags 400: when leadId is missing', async () => {
    const res = mockRes();
    await appendLeadTags(
      mockReq({ params: {}, body: { tags: ['a'] } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('appendLeadTags 404: when the lead does not exist', async () => {
    postgres._setSelect([]); // ensureLeadExists -> false
    const res = mockRes();
    await appendLeadTags(
      mockReq({ params: { leadId: 'l1' }, body: { tags: ['a'] } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteLeadTags 404: when the lead does not exist', async () => {
    postgres._setSelect([]);
    const res = mockRes();
    await deleteLeadTags(
      mockReq({ params: { leadId: 'l1' }, body: { tag: 'a' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteLeadTags 200: deletes multiple tags by name (any() branch)', async () => {
    postgres._setSelect([{ id: 'l1' }]); // exists
    const res = mockRes();
    await deleteLeadTags(
      mockReq({ params: { leadId: 'l1' }, body: { tags: ['a', 'b'] } }),
      res,
      jest.fn()
    );
    expect(postgres.execute).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data).toEqual(['a', 'b']);
  });

  it('createLeadNote 400: when leadId is missing', async () => {
    const res = mockRes();
    await createLeadNote(
      mockReq({ params: {}, body: { note: 'hi' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getMeeting 400: when meetingId is missing', async () => {
    const res = mockRes();
    await getMeeting(mockReq({ params: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createDeal 400: when the body is empty', async () => {
    const res = mockRes();
    await createDeal(mockReq({ body: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(postgres.insert).not.toHaveBeenCalled();
  });

  it('updateDeal 400: when dealId is missing', async () => {
    const res = mockRes();
    await updateDeal(
      mockReq({ params: {}, body: { status: 'signed' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateDeal 400: when the update body is empty', async () => {
    const res = mockRes();
    await updateDeal(
      mockReq({ params: { dealId: 'd1' }, body: {} }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('updateLead non-core fields + tag/note normalization', () => {
  it('200: with only tags/notes (objects) re-reads via the refresh select', async () => {
    const leadId = new ObjectId().toHexString();
    // No core-field update -> the lead .update().returning() path is skipped, so
    // the transaction falls through to the refresh select (return refreshed[0]).
    postgres._setReturning([]);
    postgres._setSelect([{ id: leadId, status: 'open' }]);
    postgres.query.leads.findFirst.mockResolvedValue({
      id: leadId,
      status: 'open',
      leadTags: [],
      leadNotes: [],
      meetingTranscripts: []
    });
    const res = mockRes();

    await updateLead(
      mockReq({
        user: admin,
        params: { leadId },
        body: {
          // object-shaped tag -> normalizeTags object branch
          tags: [{ tag: 'vip' }, 'vip'],
          // object-shaped notes -> normalizeNotes object branch
          notes: [{ note: 'call back' }],
          // an additional (non-core) field -> additionalUpdates path
          bachelorGPA: '3.8'
        }
      }),
      res,
      jest.fn()
    );

    expect(postgres.transaction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data.id).toBe(leadId);
  });
});

describe('appendLeadTags tag normalization edge', () => {
  it('200: drops non-string/non-object tags (normalizeTags -> null filtered out)', async () => {
    postgres._setSelect([{ id: 'l1' }]); // exists
    const res = mockRes();
    await appendLeadTags(
      mockReq({
        user: admin,
        params: { leadId: 'l1' },
        // 42 -> normalizeTags `return null` branch; 'vip' survives.
        body: { tags: [42, 'vip'] }
      }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('createLeadNote note normalization edge', () => {
  it('400: when notes is a non-array/non-string (normalizeNotes -> [])', async () => {
    const res = mockRes();
    await createLeadNote(
      mockReq({ params: { leadId: 'l1' }, body: { notes: 123 } }),
      res,
      jest.fn()
    );
    // normalizeNotes(123) -> [] -> empty -> 400
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
