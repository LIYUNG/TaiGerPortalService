// Integration test for the tickets routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/tickets ->
//   real TicketService -> MOCKED TicketDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query/populate construction is covered by the DAO unit tests. Fully
// deterministic — no engine flake.

import request from 'supertest';

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn((req, res, next) => {
    req.tenantId = 'test';
    next();
  })
}));
jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn((req, res, next) => next())
}));
jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn((req, res, next) => next()),
  permit: jest.fn(() => (req, res, next) => next())
}));
jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn((req, res, next) => next())
}));
// createTicket fires an email to the student's agents after responding; stub it
// so the test never reaches the mail transport.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  TicketCreatedAgentEmail: jest.fn(),
  TicketResolvedRequesterReminderEmail: jest.fn()
}));
// createTicket's notification path (post-response, fire-and-forget) re-reads the
// program + student to build the agent email. Stub just those reads so the
// lingering after-response work doesn't race the next test. The core
// create -> persist path under test stays fully real.
jest.mock('../../services/programs', () => ({
  ...jest.requireActual('../../services/programs'),
  getProgramById: jest.fn().mockResolvedValue({})
}));
jest.mock('../../services/students', () => ({
  ...jest.requireActual('../../services/students'),
  getStudentById: jest.fn().mockResolvedValue({ agents: [] })
}));

// The data boundary: mock the DAO the ticket service delegates to.
jest.mock('../../dao/ticket.dao');

import TicketDAO from '../../dao/ticket.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';
import { generateProgram, generateTicket } from '../fixtures/faker';

const api = request(app);

const program1 = generateProgram();
const seededTicket = generateTicket({
  programId: program1._id,
  requesterId: admin._id
});

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation((req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/tickets', () => {
  it('returns the tickets from the DAO as an array', async () => {
    TicketDAO.getTickets.mockResolvedValue([seededTicket]);

    const resp = await api.get('/api/tickets').set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(1);
    expect(resp.body.data[0]._id.toString()).toBe(seededTicket._id.toString());
    // admin is a TaiGer role, so the requester is populated.
    expect(TicketDAO.getTickets).toHaveBeenCalledWith(
      {},
      { populateRequester: true }
    );
  });

  it('passes the status filter through to the DAO query', async () => {
    TicketDAO.getTickets.mockResolvedValue([]);

    const resp = await api
      .get('/api/tickets?status=resolved')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveLength(0);
    expect(TicketDAO.getTickets).toHaveBeenCalledWith(
      { status: 'resolved' },
      { populateRequester: true }
    );
  });
});

describe('GET /api/tickets/overview', () => {
  it('returns the paginated envelope from the service/DAO', async () => {
    TicketDAO.getTicketsOverview.mockResolvedValue({
      tickets: [seededTicket],
      total: 1
    });

    const resp = await api
      .get('/api/tickets/overview?page=1&limit=20&type=program&search=mit')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveLength(1);
    expect(resp.body.total).toBe(1);
    expect(resp.body.page).toBe(1);
    expect(resp.body.limit).toBe(20);
    // the service parses the query into DAO args (search trimmed, filters built).
    expect(TicketDAO.getTicketsOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { type: 'program' },
        search: 'mit',
        skip: 0,
        limit: 20
      })
    );
  });
});

describe('POST /api/tickets', () => {
  it('creates a ticket via the DAO, stamping requester_id from req.user', async () => {
    const created = {
      _id: seededTicket._id,
      description: 'new ticket from integration test',
      requester_id: admin._id
    };
    TicketDAO.createTicket.mockResolvedValue(created);

    const post = await api
      .post('/api/tickets')
      .set('tenantId', TENANT_ID)
      .send({
        program_id: program1._id,
        type: 'program',
        status: 'open',
        description: 'new ticket from integration test'
      });

    expect(post.status).toBe(201);
    expect(post.body.success).toBe(true);
    expect(post.body.data.description).toBe('new ticket from integration test');
    expect(post.body.data.requester_id.toString()).toBe(admin._id.toString());
    // controller stamps requester_id from req.user before delegating to the DAO.
    expect(TicketDAO.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'new ticket from integration test',
        requester_id: admin._id.toString()
      })
    );
  });
});

describe('PUT /api/tickets/:ticket_id', () => {
  it('updates the ticket via the DAO and returns the updated record', async () => {
    TicketDAO.updateTicketById.mockResolvedValue({
      _id: seededTicket._id,
      status: 'in_progress'
    });

    const put = await api
      .put(`/api/tickets/${seededTicket._id}`)
      .set('tenantId', TENANT_ID)
      .send({ status: 'in_progress' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.data.status).toBe('in_progress');
    expect(TicketDAO.updateTicketById).toHaveBeenCalledWith(
      seededTicket._id.toString(),
      expect.objectContaining({ status: 'in_progress' })
    );
  });
});

describe('DELETE /api/tickets/:ticket_id', () => {
  it('deletes the ticket via the DAO scoped to the ticket id', async () => {
    TicketDAO.deleteTicketById.mockResolvedValue({ _id: seededTicket._id });

    const del = await api
      .delete(`/api/tickets/${seededTicket._id}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    expect(TicketDAO.deleteTicketById).toHaveBeenCalledWith(
      seededTicket._id.toString()
    );
  });
});
