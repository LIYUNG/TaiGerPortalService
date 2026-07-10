// Integration test for the events routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware (incl. event_multitenant_filter)
//   -> real controllers/events -> real EventService / UserService ->
//   MOCKED EventDAO / UserDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. Emails sent on
// create/update/delete are stubbed so no SMTP connection is opened. Fully
// deterministic — no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/auth', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.authMock({ localAuth: mw.passthroughFn() });
});

// The meeting create/update/delete handlers notify participants by email; stub
// the senders so no SMTP connection is opened.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  MeetingInvitationEmail: jest.fn(),
  MeetingConfirmationReminderEmail: jest.fn(),
  MeetingAdjustReminderEmail: jest.fn(),
  MeetingCancelledReminderEmail: jest.fn()
}));

// The data boundary: mock the DAOs the event/user services delegate to.
jest.mock('../../dao/event.dao');
jest.mock('../../dao/user.dao');

import EventDAOModule from '../../dao/event.dao';
import UserDAOModule from '../../dao/user.dao';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { student, student2, agent2, student3, agent } from '../mock/user';
import { event2, event3, eventNew, eventNew2 } from '../mock/events';
import { app } from '../../app';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const EventDAO = EventDAOModule as unknown as MockedDAO;
const UserDAO = UserDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = student;
      next();
    }
  );
  // Sensible defaults; individual tests override as needed.
  UserDAO.findAgents.mockResolvedValue([]);
  UserDAO.findEditors.mockResolvedValue([]);
});

describe('GET /api/events/ping', () => {
  it('returns the number of active future events for the user', async () => {
    EventDAO.findEvents.mockResolvedValue([{ _id: 'e1' }, { _id: 'e2' }]);

    const resp = await requestWithSupertest
      .get('/api/events/ping')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('number');
    expect(resp.body.data).toBe(2);
    expect(EventDAO.findEvents).toHaveBeenCalled();
  });
});

describe('GET /api/events/paginated', () => {
  it('returns the role-scoped paginated payload for the user (200)', async () => {
    EventDAO.getEventsPaginated.mockResolvedValue({
      events: [{ _id: 'e1' }],
      total: 1,
      page: 1,
      limit: 20
    });

    const resp = await requestWithSupertest
      .get('/api/events/paginated?page=1&limit=20')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual({
      events: [{ _id: 'e1' }],
      total: 1,
      page: 1,
      limit: 20
    });
    // The default user is a student => scoped to their own requested events.
    expect(EventDAO.getEventsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ requester_id: student._id })
      })
    );
  });
});

describe('POST /api/events/', () => {
  it('rejects booking a further event when there is an upcoming one (403)', async () => {
    // POST /api/events/ expects scalar requester_id/receiver_id (see
    // controllers/events.ts), unlike the persisted Event doc's array shape the
    // fixture's inferred type reflects.
    eventNew2.requester_id = student._id as unknown as string[];
    eventNew2.receiver_id = agent._id as unknown as string[];
    // First findEvents (the conflict check) returns a non-empty list => 403.
    EventDAO.findEvents.mockResolvedValue([{ _id: 'conflict' }]);

    const resp = await requestWithSupertest
      .post('/api/events/')
      .set('tenantId', TENANT_ID)
      .send(eventNew2);

    expect(resp.status).toBe(403);
    expect(resp.body.success).toBe(false);
    expect(EventDAO.createEvent).not.toHaveBeenCalled();
  });

  it('creates a new event when there is no conflict (201)', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = student3;
        next();
      }
    );
    eventNew.requester_id = student3._id as unknown as string[];
    eventNew.receiver_id = agent2._id as unknown as string[];

    const createdId = new Types.ObjectId().toHexString();
    // 1st findEvents (conflict check) is empty => proceed to create.
    // 2nd findEvents (after create) returns the requester's events.
    EventDAO.findEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: createdId }]);
    EventDAO.createEvent.mockResolvedValue({ _id: createdId });
    EventDAO.getEventByIdPopulated.mockResolvedValue({
      _id: createdId,
      start: new Date(),
      receiver_id: []
    });

    const resp = await requestWithSupertest
      .post('/api/events/')
      .set('tenantId', TENANT_ID)
      .send(eventNew);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.hasEvents).toBe(true);
    expect(EventDAO.createEvent).toHaveBeenCalled();
  });
});

describe('PUT /api/events/:event_id', () => {
  it('forbids a student from updating an event they do not own (403)', async () => {
    // event_multitenant_filter reads the event; requester_id does NOT contain
    // the logged-in student => 403.
    EventDAO.getEventByIdLean.mockResolvedValue({
      _id: event2._id,
      requester_id: [new Types.ObjectId()],
      receiver_id: [new Types.ObjectId()]
    });

    const resp = await requestWithSupertest
      .put(`/api/events/${event2._id}`)
      .set('tenantId', TENANT_ID)
      .send({ ...event2, description: 'updated' });

    expect(resp.status).toBe(403);
    expect(EventDAO.updateEventById).not.toHaveBeenCalled();
  });

  it('updates an event the requester owns (200)', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = student2;
        next();
      }
    );
    const ownedId = new Types.ObjectId().toHexString();
    // event_multitenant_filter passes: requester_id contains student2._id.
    EventDAO.getEventByIdLean.mockResolvedValue({
      _id: ownedId,
      requester_id: [new Types.ObjectId(student2._id)],
      receiver_id: [new Types.ObjectId(agent._id)]
    });
    EventDAO.updateEventById.mockResolvedValue({
      _id: ownedId,
      requester_id: [{ _id: student2._id }],
      receiver_id: [{ _id: agent._id }]
    });

    const resp = await requestWithSupertest
      .put(`/api/events/${ownedId}`)
      .set('tenantId', TENANT_ID)
      .send({
        start: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        addMeetingAssistant: false
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(ownedId);
    expect(EventDAO.updateEventById).toHaveBeenCalled();
  });
});

describe('DELETE /api/events/:event_id', () => {
  it('deletes the event and reports success (200)', async () => {
    // event_multitenant_filter passes: requester_id contains the student.
    EventDAO.getEventByIdLean.mockResolvedValue({
      _id: event3._id,
      requester_id: [new Types.ObjectId(student._id)],
      receiver_id: [new Types.ObjectId(agent2._id)]
    });
    EventDAO.getEventByIdPopulated.mockResolvedValue({
      _id: event3._id,
      start: new Date(),
      requester_id: [{ _id: student._id }],
      receiver_id: [
        {
          _id: agent2._id,
          firstname: 'A',
          lastname: 'B',
          email: 'a@b.com'
        }
      ]
    });
    EventDAO.deleteEventById.mockResolvedValue({ _id: event3._id });
    EventDAO.findEvents.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .delete(`/api/events/${event3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(EventDAO.deleteEventById).toHaveBeenCalledWith(
      event3._id.toString()
    );
  });
});
