// Controller UNIT test for controllers/events.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and a MOCKED service layer.
// No route, no supertest, no middleware, no database. We assert ONLY the
// controller's own work: the args it forwards to EventService/UserService, the
// status + body it writes to res, the role-based branching / conflict guard it
// owns, and that a service error is forwarded to next().
//
// The full route -> controller -> service -> dao -> in-memory Mongo wiring is
// covered by __tests__/integration/events.test.js.

jest.mock('../../services/events');
jest.mock('../../services/users');
jest.mock('../../utils/meeting-assistant.service', () => ({
  scheduleInviteTA: jest.fn().mockResolvedValue({ success: true }),
  instantInviteTA: jest.fn().mockResolvedValue({ success: true })
}));
jest.mock('../../services/email', () => ({
  MeetingInvitationEmail: jest.fn(),
  MeetingConfirmationReminderEmail: jest.fn(),
  MeetingAdjustReminderEmail: jest.fn(),
  MeetingCancelledReminderEmail: jest.fn()
}));

const { ObjectId } = require('mongoose').Types;
const EventService = require('../../services/events');
const UserService = require('../../services/users');
const { scheduleInviteTA } = require('../../utils/meeting-assistant.service');
const {
  getEvents,
  getEventsPaginated,
  buildEventScopeFilter,
  getBookedEvents,
  getActiveEventsNumber,
  showEvent,
  postEvent,
  confirmEvent,
  updateEvent,
  deleteEvent
} = require('../../controllers/events');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, agent, student } = require('../mock/user');

// `agents`/`editors` arrays the controller reads off req.user.
const studentUser = { ...student, agents: [agent._id], editors: [] };
// An agent acting as the TaiGer rep (receiver) for staff branches.
const agentUser = { ...agent, agents: [], editors: [] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getActiveEventsNumber', () => {
  it('responds 200 with the COUNT of future confirmed events', async () => {
    EventService.findEvents.mockResolvedValue([{}, {}, {}]);
    const res = mockRes();

    await getActiveEventsNumber(mockReq({ user: studentUser }), res, jest.fn());

    expect(EventService.findEvents).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: 3 });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    EventService.findEvents.mockRejectedValue(err);
    const next = jest.fn();

    await getActiveEventsNumber(
      mockReq({ user: studentUser }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getBookedEvents', () => {
  it('responds 200 with the booked events for a student', async () => {
    const booked = [{ _id: 'e1' }];
    EventService.findEvents.mockResolvedValue(booked);
    const res = mockRes();

    await getBookedEvents(
      mockReq({ user: studentUser, query: {} }),
      res,
      jest.fn()
    );

    expect(EventService.findEvents).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: booked });
  });

  it('responds 403 for a non-student and never touches the service', async () => {
    const res = mockRes();

    await getBookedEvents(mockReq({ user: agent, query: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(EventService.findEvents).not.toHaveBeenCalled();
  });
});

describe('getEvents', () => {
  it('responds 200 with agents, editors, events and the hasEvents flag', async () => {
    UserService.findAgents.mockResolvedValue([{ _id: 'a1' }]);
    UserService.findEditors.mockResolvedValue([]);
    EventService.findEvents.mockResolvedValue([{ _id: 'e1' }, { _id: 'e2' }]);
    const res = mockRes();

    await getEvents(mockReq({ user: studentUser, query: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.agents).toEqual([{ _id: 'a1' }]);
    expect(body.editors).toEqual([]);
    expect(body.data).toHaveLength(2);
    expect(body.hasEvents).toBe(true);
  });

  it('filters on event `end` by default (unchanged for existing callers)', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    EventService.findEvents.mockResolvedValue([]);

    await getEvents(
      mockReq({
        user: studentUser,
        query: {
          startTime: '2025-06-01T00:00:00.000Z',
          endTime: '2025-06-30T23:59:59.999Z'
        }
      }),
      mockRes(),
      jest.fn()
    );

    const [filter] = EventService.findEvents.mock.calls[0];
    expect(filter).toHaveProperty('end');
    expect(filter).not.toHaveProperty('start');
  });

  it('filters on event `start` when rangeField=start (calendar window)', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    EventService.findEvents.mockResolvedValue([]);

    await getEvents(
      mockReq({
        user: studentUser,
        query: {
          rangeField: 'start',
          startTime: '2025-06-01T00:00:00.000Z',
          endTime: '2025-06-30T23:59:59.999Z'
        }
      }),
      mockRes(),
      jest.fn()
    );

    const [filter] = EventService.findEvents.mock.calls[0];
    expect(filter).toHaveProperty('start');
    expect(filter).not.toHaveProperty('end');
  });

  it('hasEvents is false when no events are returned', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    EventService.findEvents.mockResolvedValue([]);
    const res = mockRes();

    await getEvents(mockReq({ user: studentUser, query: {} }), res, jest.fn());

    const body = res.send.mock.calls[0][0];
    expect(body.hasEvents).toBe(false);
    expect(body.data).toEqual([]);
  });
});

describe('buildEventScopeFilter', () => {
  it('scopes a student to their own requested events, ignoring client filters', () => {
    const filter = buildEventScopeFilter(studentUser, {
      receiver_id: 'hack-receiver',
      requester_id: 'hack-requester'
    });
    expect(filter).toEqual({ requester_id: studentUser._id });
  });

  it('does not hard-restrict staff, but honors optional receiver_id/requester_id', () => {
    expect(buildEventScopeFilter(agentUser, {})).toEqual({});
    expect(buildEventScopeFilter(agentUser, { receiver_id: 'rc1' })).toEqual({
      receiver_id: 'rc1'
    });
    expect(buildEventScopeFilter(admin, { requester_id: 'r1' })).toEqual({
      requester_id: 'r1'
    });
  });
});

describe('getEventsPaginated', () => {
  it('student: scopes to own past events (ignoring client filters) and 200s with the page', async () => {
    const paginated = { events: [{ _id: 'e1' }], total: 1, page: 1, limit: 20 };
    EventService.getEventsPaginated.mockResolvedValue(paginated);
    const res = mockRes();

    await getEventsPaginated(
      mockReq({
        user: studentUser,
        query: { page: '1', limit: '20', receiver_id: 'hack' }
      }),
      res,
      jest.fn()
    );

    expect(EventService.getEventsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          requester_id: studentUser._id,
          end: expect.objectContaining({ $lt: expect.any(Date) })
        }),
        query: expect.objectContaining({ page: '1', limit: '20' })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: paginated });
  });

  it('staff: no hard scope but honors the receiver_id filter', async () => {
    EventService.getEventsPaginated.mockResolvedValue({
      events: [],
      total: 0,
      page: 1,
      limit: 20
    });
    const res = mockRes();

    await getEventsPaginated(
      mockReq({ user: agentUser, query: { receiver_id: 'rc1' } }),
      res,
      jest.fn()
    );

    expect(EventService.getEventsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ receiver_id: 'rc1' })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    EventService.getEventsPaginated.mockRejectedValue(err);
    const next = jest.fn();

    await getEventsPaginated(
      mockReq({ user: agentUser, query: {} }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('showEvent', () => {
  it('responds 200 (json) with the event the service resolves', async () => {
    const event = { _id: 'e1', title: 'OH' };
    EventService.getEventById.mockResolvedValue(event);
    const res = mockRes();

    await showEvent(mockReq({ params: { event_id: 'e1' } }), res, jest.fn());

    expect(EventService.getEventById).toHaveBeenCalledWith('e1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(event);
  });
});

describe('postEvent (student branch)', () => {
  it('201: creates the event when there is no conflicting slot', async () => {
    const newEventId = new ObjectId().toHexString();
    // 1st findEvents -> conflict check (none). 2nd findEvents -> list returned.
    EventService.findEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'e1' }]);
    EventService.createEvent.mockResolvedValue({ _id: newEventId });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: newEventId,
      start: new Date().toISOString(),
      receiver_id: []
    });
    UserService.findAgents.mockResolvedValue([]);
    const res = mockRes();

    await postEvent(
      mockReq({
        user: studentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agent._id
        }
      }),
      res,
      jest.fn()
    );

    expect(EventService.createEvent).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ _id: 'e1' }]);
  });

  it('forwards a 403 ErrorResponse to next() when there is a conflicting slot', async () => {
    EventService.findEvents.mockResolvedValue([{ _id: 'conflict' }]);
    const next = jest.fn();
    const res = mockRes();

    await postEvent(
      mockReq({
        user: studentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agent._id
        }
      }),
      res,
      next
    );

    expect(EventService.createEvent).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('one-total: the future-conflict clause is scoped to the student only (any agent), not the agent', async () => {
    // No conflict -> creation proceeds; we inspect the conflict query that ran.
    EventService.findEvents.mockResolvedValue([]);
    EventService.createEvent.mockResolvedValue({
      _id: new ObjectId().toHexString()
    });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: 'x',
      start: new Date().toISOString(),
      receiver_id: []
    });
    UserService.findAgents.mockResolvedValue([]);

    await postEvent(
      mockReq({
        user: studentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agent._id
        }
      }),
      mockRes(),
      jest.fn()
    );

    const conflictQuery = EventService.findEvents.mock.calls[0][0];
    const futureClause = conflictQuery.$or.find((c) => c.start && c.start.$gt);
    expect(futureClause).toBeDefined();
    expect(futureClause.requester_id).toBeDefined();
    // One appointment at a time across ALL agents -> the future clause must NOT
    // narrow to the chosen agent.
    expect(futureClause.receiver_id).toBeUndefined();
  });

  it('responds 409 (next) when the slot was just booked under a race (duplicate-key)', async () => {
    EventService.findEvents.mockResolvedValue([]); // passes the app-level check
    EventService.createEvent.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    );
    const next = jest.fn();

    await postEvent(
      mockReq({
        user: studentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agent._id
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it('emails each receiver via meetingConfirmationReminder after creating', async () => {
    const newEventId = new ObjectId().toHexString();
    EventService.findEvents
      .mockResolvedValueOnce([]) // conflict check
      .mockResolvedValueOnce([{ _id: 'e1' }]); // refreshed list
    EventService.createEvent.mockResolvedValue({ _id: newEventId });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: newEventId,
      start: new Date().toISOString(),
      // Non-empty receiver list -> meetingConfirmationReminder body runs.
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ]
    });
    UserService.findAgents.mockResolvedValue([]);
    const {
      MeetingConfirmationReminderEmail
    } = require('../../services/email');
    const res = mockRes();

    await postEvent(
      mockReq({
        user: studentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agent._id
        }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(MeetingConfirmationReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('swallows the conflict-check error then forwards the downstream TypeError', async () => {
    // First findEvents rejects -> caught + logged; `events` stays undefined so
    // the subsequent events.length read throws and is forwarded to next().
    EventService.findEvents.mockRejectedValueOnce(new Error('pre-check down'));
    const next = jest.fn();

    await postEvent(
      mockReq({
        user: studentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agent._id
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(EventService.createEvent).not.toHaveBeenCalled();
  });
});

describe('updateEvent', () => {
  it('200: updates the event and forwards id + payload + projection', async () => {
    const eventId = new ObjectId().toHexString();
    const updated = {
      _id: eventId,
      receiver_id: [],
      requester_id: [],
      start: new Date().toISOString()
    };
    EventService.updateEventById.mockResolvedValue(updated);
    const res = mockRes();

    await updateEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      res,
      jest.fn()
    );

    expect(EventService.updateEventById).toHaveBeenCalledWith(
      eventId,
      expect.any(Object),
      'firstname lastname email'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('emails each receiver and schedules the assistant when enabled', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      requester_id: [],
      meetingLink: 'https://meet.jit.si/x',
      start: new Date().toISOString(),
      end: new Date().toISOString()
    });
    const { MeetingAdjustReminderEmail } = require('../../services/email');
    const res = mockRes();

    await updateEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: true }
      }),
      res,
      jest.fn()
    );
    await new Promise((r) => setImmediate(r));

    expect(MeetingAdjustReminderEmail).toHaveBeenCalledTimes(1);
    expect(scheduleInviteTA).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteEvent (student branch)', () => {
  it('200: deletes the event and returns the refreshed list', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: eventId,
      requester_id: [
        { _id: studentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      receiver_id: []
    });
    EventService.deleteEventById.mockResolvedValue({});
    EventService.findEvents.mockResolvedValue([]);
    UserService.findAgents.mockResolvedValue([]);
    const res = mockRes();

    await deleteEvent(
      mockReq({ user: studentUser, params: { event_id: eventId } }),
      res,
      jest.fn()
    );

    expect(EventService.deleteEventById).toHaveBeenCalledWith(eventId);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('forwards the cancellation reason from the request body into the email', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: eventId,
      requester_id: [
        { _id: studentUser._id, firstname: 'S', lastname: 'T', email: 's@t.c' }
      ],
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ]
    });
    EventService.deleteEventById.mockResolvedValue({});
    EventService.findEvents.mockResolvedValue([]);
    UserService.findAgents.mockResolvedValue([]);
    const { MeetingCancelledReminderEmail } = require('../../services/email');

    await deleteEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { reason: 'Schedule conflict' }
      }),
      mockRes(),
      jest.fn()
    );

    expect(MeetingCancelledReminderEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ reason: 'Schedule conflict' })
    );
  });

  it('agent branch: 200 with the refreshed (non-empty) list', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: eventId,
      requester_id: [
        { _id: studentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      receiver_id: [{ _id: agentUser._id }]
    });
    EventService.deleteEventById.mockResolvedValue({});
    EventService.findEvents.mockResolvedValue([{ _id: 'e1' }]);
    UserService.findAgents.mockResolvedValue([]);
    const res = mockRes();

    await deleteEvent(
      mockReq({ user: agentUser, params: { event_id: eventId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data).toEqual([{ _id: 'e1' }]);
    expect(body.hasEvents).toBe(true);
  });

  it('guest branch (no role): 200 with hasEvents false', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: eventId,
      requester_id: [],
      receiver_id: []
    });
    EventService.deleteEventById.mockResolvedValue({});
    const res = mockRes();

    await deleteEvent(
      mockReq({
        user: { ...admin, role: 'Guest' },
        params: { event_id: eventId }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, hasEvents: false });
  });

  it('forwards a 400 ErrorResponse to next() when the service throws', async () => {
    EventService.getEventByIdPopulated.mockRejectedValue(new Error('boom'));
    const next = jest.fn();

    await deleteEvent(
      mockReq({ user: studentUser, params: { event_id: 'e1' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});

describe('getEvents (agent branch)', () => {
  it('builds the response from agents/editors lookups for a staff user', async () => {
    UserService.findAgents.mockResolvedValue([{ _id: 'a1' }]);
    UserService.findEditors.mockResolvedValue([{ _id: 'ed1' }]);
    EventService.findEvents.mockResolvedValue([{ _id: 'e1' }]);
    const res = mockRes();

    await getEvents(
      mockReq({
        user: agentUser,
        query: { requester_id: 'r1', receiver_id: 'rc1' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.editors).toEqual([{ _id: 'ed1' }]);
    expect(body.hasEvents).toBe(true);
  });
});

describe('postEvent (staff branch)', () => {
  it('201: creates the event when there is no conflicting slot', async () => {
    const newEventId = new ObjectId().toHexString();
    EventService.findEvents
      .mockResolvedValueOnce([]) // conflict check
      .mockResolvedValueOnce([{ _id: 'e1' }]); // refreshed list
    EventService.createEvent.mockResolvedValue({ _id: newEventId });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: newEventId,
      start: new Date().toISOString(),
      requester_id: []
    });
    UserService.findAgents.mockResolvedValue([]);
    const res = mockRes();

    await postEvent(
      mockReq({
        user: agentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agentUser._id
        }
      }),
      res,
      jest.fn()
    );

    expect(EventService.createEvent).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send.mock.calls[0][0].data).toEqual([{ _id: 'e1' }]);
  });

  it('forwards a 500 ErrorResponse to next() when there is a conflicting slot', async () => {
    EventService.findEvents.mockResolvedValue([{ _id: 'conflict' }]);
    const next = jest.fn();

    await postEvent(
      mockReq({
        user: agentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agentUser._id
        }
      }),
      mockRes(),
      next
    );

    expect(EventService.createEvent).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 })
    );
  });

  it('emails each requester via meetingConfirmationReminder after creating', async () => {
    const newEventId = new ObjectId().toHexString();
    EventService.findEvents
      .mockResolvedValueOnce([]) // conflict check
      .mockResolvedValueOnce([{ _id: 'e1' }]); // refreshed list
    EventService.createEvent.mockResolvedValue({ _id: newEventId });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: newEventId,
      start: new Date().toISOString(),
      // Non-empty requester list -> staff-branch reminder forEach runs.
      requester_id: [
        { _id: studentUser._id, firstname: 'S', lastname: 'T', email: 's@t.c' }
      ]
    });
    UserService.findAgents.mockResolvedValue([]);
    const {
      MeetingConfirmationReminderEmail
    } = require('../../services/email');
    const res = mockRes();

    await postEvent(
      mockReq({
        user: agentUser,
        body: {
          start: new Date().toISOString(),
          requester_id: studentUser._id,
          receiver_id: agentUser._id
        }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(MeetingConfirmationReminderEmail).toHaveBeenCalledTimes(1);
  });
});

describe('confirmEvent', () => {
  it('student branch: 200 with the updated event (assistant disabled)', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      requester_id: []
    });
    const res = mockRes();

    await confirmEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].success).toBe(true);
  });

  it('agent branch: looks up the event then 200 with the updated event', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: eventId,
      requester_id: [{ _id: studentUser._id, firstname: 'S', lastname: 'T' }]
    });
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      requester_id: [
        { _id: studentUser._id, firstname: 'S', lastname: 'T', email: 's@t.c' }
      ],
      receiver_id: []
    });
    const res = mockRes();

    await confirmEvent(
      mockReq({
        user: agentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      res,
      jest.fn()
    );

    expect(EventService.getEventByIdPopulated).toHaveBeenCalledWith(
      eventId,
      'firstname lastname email pictureUrl'
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('schedules the meeting assistant (success path) when enabled', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      requester_id: [],
      meetingLink: 'https://meet.jit.si/x',
      start: new Date().toISOString(),
      end: new Date().toISOString()
    });
    scheduleInviteTA.mockResolvedValueOnce({ success: true, meetingId: 'm1' });
    const res = mockRes();

    await confirmEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: true }
      }),
      res,
      jest.fn()
    );
    // handleTAScheduling is fire-and-forget; let its microtasks settle.
    await new Promise((r) => setImmediate(r));

    expect(scheduleInviteTA).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('logs a failure when the meeting assistant reports !success', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      requester_id: [],
      meetingLink: 'https://meet.jit.si/x',
      start: new Date().toISOString(),
      end: new Date().toISOString()
    });
    scheduleInviteTA.mockResolvedValueOnce({ success: false });
    const res = mockRes();

    await confirmEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: true }
      }),
      res,
      jest.fn()
    );
    await new Promise((r) => setImmediate(r));

    expect(scheduleInviteTA).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('swallows a meeting-assistant scheduling error (catch branch)', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      receiver_id: [
        { _id: agentUser._id, firstname: 'A', lastname: 'B', email: 'a@b.c' }
      ],
      requester_id: [],
      meetingLink: 'https://meet.jit.si/x',
      start: new Date().toISOString(),
      end: new Date().toISOString()
    });
    scheduleInviteTA.mockRejectedValueOnce(new Error('assistant down'));
    const res = mockRes();

    await confirmEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: true }
      }),
      res,
      jest.fn()
    );
    await new Promise((r) => setImmediate(r));

    expect(scheduleInviteTA).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('404 (json) when the update finds no event', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue(null);
    const res = mockRes();

    await confirmEvent(
      mockReq({
        user: studentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'event is not found' });
  });

  it('forwards a 400 ErrorResponse to next() when the service throws', async () => {
    EventService.updateEventById.mockRejectedValue(new Error('boom'));
    const next = jest.fn();

    await confirmEvent(
      mockReq({
        user: studentUser,
        params: { event_id: 'e1' },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});

describe('updateEvent (staff branch + 404)', () => {
  it('agent branch: 200 with the updated event', async () => {
    const eventId = new ObjectId().toHexString();
    EventService.updateEventById.mockResolvedValue({
      _id: eventId,
      requester_id: [
        { _id: studentUser._id, firstname: 'S', lastname: 'T', email: 's@t.c' }
      ],
      receiver_id: []
    });
    const res = mockRes();

    await updateEvent(
      mockReq({
        user: agentUser,
        params: { event_id: eventId },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].success).toBe(true);
  });

  it('404 (json) when the update finds no event', async () => {
    EventService.updateEventById.mockResolvedValue(null);
    const res = mockRes();

    await updateEvent(
      mockReq({
        user: studentUser,
        params: { event_id: 'e1' },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'event is not found' });
  });

  it('forwards a 400 ErrorResponse to next() when the service throws', async () => {
    EventService.updateEventById.mockRejectedValue(new Error('boom'));
    const next = jest.fn();

    await updateEvent(
      mockReq({
        user: studentUser,
        params: { event_id: 'e1' },
        body: { start: new Date().toISOString(), addMeetingAssistant: false }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});
