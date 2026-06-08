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
  const state = { selectResult: [], returningResult: [] };

  const builder = {};
  builder.then = (resolve, reject) =>
    Promise.resolve(state.selectResult).then(resolve, reject);
  builder.catch = (cb) => Promise.resolve(state.selectResult).catch(cb);
  builder.finally = (cb) => Promise.resolve(state.selectResult).finally(cb);

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

  const mockPostgresDb = {
    ...builder,
    $with: jest.fn().mockReturnValue({ as: jest.fn().mockReturnValue({}) }),
    with: jest.fn().mockReturnValue(builder),
    transaction: jest.fn(async (cb) => cb(mockPostgresDb)),
    execute: jest.fn().mockResolvedValue([]),
    query: { leads: { findFirst: jest.fn().mockResolvedValue(null) } },
    _setSelect: (v) => {
      state.selectResult = v;
    },
    _setReturning: (v) => {
      state.returningResult = v;
    },
    _reset: () => {
      state.selectResult = [];
      state.returningResult = [];
    }
  };

  return {
    getPostgresDb: jest.fn(() => mockPostgresDb),
    connectToDatabase: jest.fn(),
    disconnectFromDatabase: jest.fn(async () => {}),
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
const { getPostgresDb } = require('../../database');
const UserService = require('../../services/users');
const { instantInviteTA } = require('../../utils/meeting-assistant.service');
const {
  getLeads,
  getLead,
  getLeadByStudentId,
  createLeadFromStudent,
  getMeeting,
  createDeal,
  updateDeal,
  instantInviteMeetingAssistant
} = require('../../controllers/crm');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

const postgres = getPostgresDb();

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
      then: (_res, rej) => Promise.reject(err).then(_res, rej)
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
    instantInviteTA.mockResolvedValue({ success: true, meetingId: 'm-1' });
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
    instantInviteTA.mockResolvedValue({ success: false });
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
