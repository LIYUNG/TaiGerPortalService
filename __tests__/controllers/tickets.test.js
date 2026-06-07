// DB-free controller test: the Ticket DAO (and the program/student/email deps
// used by createTicket) are mocked, so no MongoDB is touched. Real query
// behaviour is covered in __tests__/dao/ticket.dao.test.js.
const passthrough = async (req, res, next) => next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(async (req, res, next) => {
    req.tenantId = 'test';
    next();
  }),
  tenantMiddleware: jest.fn(async (req, res, next) => {
    req.db = { model: () => ({}) };
    next();
  })
}));

jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn(passthrough)
}));

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => ({
  ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
  InnerTaigerMultitenantFilter: jest.fn(passthrough)
}));

jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn(passthrough),
  localAuth: jest.fn(passthrough),
  permit: jest.fn(() => passthrough)
}));

// Data-access + side-effect dependencies mocked → DB-free.
jest.mock('../../dao/ticket.dao', () => ({
  getTickets: jest.fn().mockResolvedValue([]),
  createTicket: jest.fn().mockResolvedValue({}),
  updateTicketById: jest.fn().mockResolvedValue({}),
  deleteTicketById: jest.fn().mockResolvedValue({})
}));

jest.mock('../../services/programs', () => ({
  ...jest.requireActual('../../services/programs'),
  getProgramById: jest.fn().mockResolvedValue({})
}));

jest.mock('../../services/students', () => ({
  ...jest.requireActual('../../services/students'),
  getStudentById: jest.fn().mockResolvedValue({ agents: [] })
}));

jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  TicketCreatedAgentEmail: jest.fn(),
  TicketResolvedRequesterReminderEmail: jest.fn()
}));

const request = require('supertest');
const { app } = require('../../app');
const { protect } = require('../../middlewares/auth');
const TicketDAO = require('../../dao/ticket.dao');

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = { _id: 'u1', role: 'Admin' };
    next();
  });
});

describe('GET /api/tickets', () => {
  it('passes the parsed query + role-based populate flag to the DAO', async () => {
    TicketDAO.getTickets.mockResolvedValueOnce([{ _id: 't1' }]);

    const resp = await requestWithSupertest
      .get('/api/tickets?type=program&status=open')
      .set('tenantId', 'test');

    expect(resp.status).toBe(200);
    expect(resp.body.data).toEqual([{ _id: 't1' }]);
    const [query, options] = TicketDAO.getTickets.mock.calls[0];
    expect(query).toEqual({ type: 'program', status: 'open' });
    expect(options).toEqual({ populateRequester: true });
  });
});

describe('POST /api/tickets', () => {
  it('creates a ticket and returns 201 with the DAO result', async () => {
    TicketDAO.createTicket.mockResolvedValueOnce({
      _id: 't2',
      description: 'help'
    });

    const resp = await requestWithSupertest
      .post('/api/tickets')
      .set('tenantId', 'test')
      .send({ description: 'help', program_id: 'p1' });

    expect(resp.status).toBe(201);
    expect(resp.body.data.description).toBe('help');
    expect(TicketDAO.createTicket).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/tickets/:ticket_id', () => {
  it('updates a ticket via the DAO', async () => {
    TicketDAO.updateTicketById.mockResolvedValueOnce({
      _id: 't1',
      description: 'new'
    });

    const resp = await requestWithSupertest
      .put('/api/tickets/t1')
      .set('tenantId', 'test')
      .send({ description: 'new' });

    expect(resp.status).toBe(200);
    expect(resp.body.data.description).toBe('new');
    const [id, fields] = TicketDAO.updateTicketById.mock.calls[0];
    expect(id).toBe('t1');
    expect(fields.description).toBe('new');
  });
});

describe('DELETE /api/tickets/:ticket_id', () => {
  it('deletes a ticket via the DAO', async () => {
    const resp = await requestWithSupertest
      .delete('/api/tickets/t9')
      .set('tenantId', 'test');

    expect(resp.status).toBe(200);
    expect(TicketDAO.deleteTicketById).toHaveBeenCalledWith('t9');
  });
});
