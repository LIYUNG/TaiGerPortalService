// Full-stack integration test for the complaints (customer-center) routes:
//   supertest -> real router -> real controllers/complaints -> real
//   ComplaintService -> real ComplaintDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant/permission middleware is
// stubbed). This is the layer that catches the seam bugs — schema mismatch, bad
// query, wrong field — that the mocked controller unit test
// (../controllers/complaints.test.js) cannot see. Ported from the original
// __tests__/controllers/complaints.test.js with the weak assertions
// strengthened against the deterministic seed. Keep it thin: happy paths only.

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { complaintSchema } = require('../../models/Complaint');
const { users, student } = require('../mock/user');
const {
  tickets,
  ticket,
  ticketNew,
  ticketWithMessage
} = require('../mock/complaintTickets');
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

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    complaintTicketMultitenant_filter: jest.fn().mockImplementation(passthrough)
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
  const ComplaintSchema = db.model('Complaint', complaintSchema);

  await ComplaintSchema.deleteMany();
  await ComplaintSchema.insertMany(tickets);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  protect.mockImplementation(async (req, res, next) => {
    req.user = await UserModel.findById(student._id);
    next();
  });
});

describe('GET /api/complaints (full stack)', () => {
  it('returns the requesting student tickets as an array', async () => {
    const resp = await requestWithSupertest
      .get('/api/complaints')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    // The student is the requester on every seeded ticket.
    expect(resp.body.data.length).toBe(tickets.length);
  });
});

describe('POST /api/complaints (full stack)', () => {
  it('creates a ticket stamped with the requester id', async () => {
    const resp = await requestWithSupertest
      .post('/api/complaints')
      .set('tenantId', TENANT_ID)
      .send({ ticket: ticketNew });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.requester_id.toString()).toBe(student._id.toString());
  });
});

describe('GET /api/complaints/:ticketId (full stack)', () => {
  it('returns the persisted ticket by id', async () => {
    const resp = await requestWithSupertest
      .get(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(ticket._id.toString());
  });
});

describe('POST /api/complaints/new-message/:ticketId/:studentId (full stack)', () => {
  it('appends a message that is visible on the refreshed ticket', async () => {
    const resp = await requestWithSupertest
      .post(
        `/api/complaints/new-message/${ticket._id.toString()}/${student._id}`
      )
      .set('tenantId', TENANT_ID)
      .send({
        message:
          '{"time":1709677608094,"blocks":[{"id":"9ntXJB6f3L","type":"paragraph","data":{"text":"New message"}}],"version":"2.29.0"}'
      });

    expect(resp.status).toBe(201);
    expect(resp.body.data.messages[0].message).toContain('New message');
  });
});

describe('PUT /api/complaints/:ticketId/:messageId (full stack)', () => {
  it('updates an existing message in a ticket', async () => {
    const resp = await requestWithSupertest
      .put(
        `/api/complaints/${ticketWithMessage._id.toString()}/${
          ticketWithMessage.messages[0]._id
        }`
      )
      .set('tenantId', TENANT_ID)
      .send({
        message:
          '{"time":1709677608094,"blocks":[{"id":"9ntXJB6f3L","type":"paragraph","data":{"text":"updated message"}}],"version":"2.29.0"}'
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('PUT /api/complaints/:ticketId (full stack)', () => {
  it('persists the updated ticket fields', async () => {
    const resp = await requestWithSupertest
      .put(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ description: 'new information' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.description).toBe('new information');
  });
});

describe('DELETE /api/complaints/:ticketId (full stack)', () => {
  it('deletes the ticket so a subsequent read 404s', async () => {
    const del = await requestWithSupertest
      .delete(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(404);
  });
});
