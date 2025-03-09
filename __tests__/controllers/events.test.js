const request = require('supertest');
const { EventSchema } = require('@taiger-common/model');

const { connect, closeDatabase, clearDatabase } = require('../fixtures/db');
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

describe('GET /api/events/all', () => {
  it('getAllEvents', async () => {
    const resp = await requestWithSupertest
      .get('/api/events/all')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('GET /api/events/ping', () => {
  it('getActiveEventsNumber', async () => {
    const resp = await requestWithSupertest
      .get('/api/events/ping')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('POST /api/events/', () => {
  it('postEvent: can not book further event if there is upcoming one', async () => {
    eventNew2.requester_id = student._id;
    eventNew2.receiver_id = agent._id;
    const resp = await requestWithSupertest
      .post('/api/events/')
      .set('tenantId', TENANT_ID)
      .send(eventNew2);

    expect(resp.status).toEqual(403);
  });

  it('postEvent', async () => {
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

    expect(resp.status).toEqual(201);
  });
});

describe('PUT /api/events/:event_id', () => {
  it('updateEvent: student is not allowed to update others events', async () => {
    const resp = await requestWithSupertest
      .put(`/api/events/${event2._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        ...event2,
        description: 'updated'
      });

    expect(resp.status).toEqual(403);
  });

  it('updateEvent', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = student2;
      next();
    });
    const resp = await requestWithSupertest
      .put(`/api/events/${event2._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        ...event2,
        description: 'updated'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/events/:event_id', () => {
  it('deleteEvent', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/events/${event3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
