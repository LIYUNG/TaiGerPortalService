const request = require('supertest');
const { ticketSchema } = require('@taiger-common/model');

const { connect, closeDatabase, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, student } = require('../mock/user');
const { app } = require('../../app');
const {
  programTickets,
  programTicketNew,
  programTicket1,
  programTicket2
} = require('../mock/tickets');
const { program1 } = require('../mock/programs');

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
  const TicketModel = db.model('Ticket', ticketSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await TicketModel.deleteMany();
  await TicketModel.insertMany(programTickets);

  protect.mockImplementation(async (req, res, next) => {
    req.user = student;
    next();
  });
});

describe('GET /api/tickets?type=program&status=open', () => {
  it('getTickets query type=program&status=open', async () => {
    const resp = await requestWithSupertest
      .get('/api/tickets?type=program&status=open')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.data.length).toEqual(3);
  });

  it('getTickets query type=program&program_id=<proramId>', async () => {
    const resp = await requestWithSupertest
      .get(`/api/tickets?type=program&program_id=${program1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.data.length).toEqual(2);
  });
});

describe('POST /api/tickets/', () => {
  it('createTicket', async () => {
    const resp = await requestWithSupertest
      .post('/api/tickets')
      .set('tenantId', TENANT_ID)
      .send(programTicketNew);

    expect(resp.status).toBe(201);
    expect(resp.body.data.description).toEqual(programTicketNew.description);
  });
});

describe('PUT /api/tickets/:ticket_id', () => {
  it('updateTicket', async () => {
    const resp = await requestWithSupertest
      .put(`/api/tickets/${programTicket1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        requesterId: student._id,
        description: 'new-description'
      });

    expect(resp.status).toEqual(200);
    expect(resp.body.data.description).toEqual('new-description');
  });
});

describe('DELETE /api/tickets/:ticket_id', () => {
  it('deleteTicket', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/tickets/${programTicket2._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
