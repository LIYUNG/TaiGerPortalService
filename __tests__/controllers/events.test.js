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
const {
  getEvents,
  getBookedEvents,
  getActiveEventsNumber,
  showEvent,
  postEvent,
  updateEvent,
  deleteEvent
} = require('../../controllers/events');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, agent, student } = require('../mock/user');

// `agents`/`editors` arrays the controller reads off req.user.
const studentUser = { ...student, agents: [agent._id], editors: [] };

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
});
