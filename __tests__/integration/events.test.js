// Full-stack integration test for the events routes:
//   supertest -> real router -> real controllers/events -> real EventService ->
//   real EventDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant/permission middleware is
// stubbed). This is the layer that catches the seam bugs — schema mismatch, bad
// query, conflicting-booking guard — that the mocked controller unit test
// (../controllers/events.test.js) cannot see. Keep it thin: a few critical
// paths with real data assertions.

const request = require('supertest');
const { EventSchema } = require('@taiger-common/model');

const { connect, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const {
  users,
  student,
  student2,
  agent2,
  student3,
  agent
} = require('../mock/user');
const {
  event3,
  events,
  event2,
  eventNew,
  eventNew2
} = require('../mock/events');
const { app } = require('../../app');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

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

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
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
  const EventModel = db.model('Event', EventSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await EventModel.deleteMany();
  await EventModel.insertMany(events);

  protect.mockImplementation(async (req, res, next) => {
    req.user = student;
    next();
  });
});

describe('GET /api/events/ping (full stack)', () => {
  it('returns the number of active future events for the user', async () => {
    const resp = await requestWithSupertest
      .get('/api/events/ping')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('number');
  });
});

describe('POST /api/events/ (full stack)', () => {
  it('rejects booking a further event when there is an upcoming one (403)', async () => {
    eventNew2.requester_id = student._id;
    eventNew2.receiver_id = agent._id;
    const resp = await requestWithSupertest
      .post('/api/events/')
      .set('tenantId', TENANT_ID)
      .send(eventNew2);

    expect(resp.status).toBe(403);
    expect(resp.body.success).toBe(false);
  });

  it('creates a new event when there is no conflict (201)', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = student3;
      next();
    });
    eventNew.requester_id = student3._id;
    eventNew.receiver_id = agent2._id;
    const resp = await requestWithSupertest
      .post('/api/events/')
      .set('tenantId', TENANT_ID)
      .send(eventNew);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.hasEvents).toBe(true);
  });
});

describe('PUT /api/events/:event_id (full stack)', () => {
  it('forbids a student from updating an event they do not own (403)', async () => {
    const resp = await requestWithSupertest
      .put(`/api/events/${event2._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        ...event2,
        description: 'updated'
      });

    expect(resp.status).toBe(403);
  });

  it('updates an event the requester owns (200)', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = student2;
      next();
    });
    // Seed a dedicated event owned by student2 so the multitenant filter passes
    // and the assertion does not depend on cross-test state.
    const db = connectToDatabase(TENANT_ID, dbUri);
    const EventModel = db.model('Event', EventSchema);
    const owned = await EventModel.create({
      requester_id: [student2._id],
      receiver_id: [agent._id],
      start: new Date(Date.now() + 60 * 60 * 1000),
      end: new Date(Date.now() + 90 * 60 * 1000),
      title: 'owned',
      description: 'original'
    });

    const resp = await requestWithSupertest
      .put(`/api/events/${owned._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        start: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        addMeetingAssistant: false
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(owned._id.toString());
  });
});

describe('DELETE /api/events/:event_id (full stack)', () => {
  it('deletes the event and reports success (200)', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/events/${event3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});
