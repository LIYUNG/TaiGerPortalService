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
afterAll(async () => await clearDatabase());

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

describe('GET /api/complaints', () => {
  it('getComplaints', async () => {
    const resp = await requestWithSupertest
      .get('/api/complaints')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toEqual(true);
  });
});

describe('POST /api/complaints', () => {
  it('createComplaint', async () => {
    const resp = await requestWithSupertest
      .post('/api/complaints')
      .set('tenantId', TENANT_ID)
      .send({ ticket: ticketNew });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toEqual(true);
  });
});

describe('message In Ticket Controller', () => {
  it('postMessageInTicket: should post a message in a ticket', async () => {
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

  it('updateAMessageInComplaint: should update a message in a ticket', async () => {
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
  });
});

describe('getComplaint Controller', () => {
  it('should get a ticket', async () => {
    const resp = await requestWithSupertest
      .get(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toEqual(true);
  });
});

describe('updateComplaint Controller', () => {
  it('should update a ticket', async () => {
    const resp = await requestWithSupertest
      .put(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ description: 'new information' });
    const updatedTicket = resp.body.data;
    expect(resp.status).toBe(200);
    expect(updatedTicket.description).toEqual('new information');
  });
});

describe('deleteComplaint Controller', () => {
  it('should delete a tickets', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toEqual(true);
  });
});
