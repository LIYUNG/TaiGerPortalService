// Full-stack integration test for the tickets routes:
//   supertest -> real router -> real controllers/tickets -> real TicketService
//   -> real TicketDAO -> in-memory MongoDB.
//
// Only auth/tenant/permission middleware and the email side-effects are stubbed;
// everything below the route runs for real, so a seam bug (schema/query/populate)
// surfaces here. Kept thin — the behaviour matrix lives in
// ../controllers/tickets.test.js (mocked) and the dao suite.

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
// lingering after-response DB work doesn't race the next test's beforeEach. The
// core create -> persist path under test stays fully real.
jest.mock('../../services/programs', () => ({
  ...jest.requireActual('../../services/programs'),
  getProgramById: jest.fn().mockResolvedValue({})
}));
jest.mock('../../services/students', () => ({
  ...jest.requireActual('../../services/students'),
  getStudentById: jest.fn().mockResolvedValue({ agents: [] })
}));

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { ticketSchema } = require('../../models/Ticket');
const { programSchema } = require('../../models/Program');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin } = require('../mock/user');
const { generateProgram, generateTicket } = require('../fixtures/faker');
const { disconnectFromDatabase } = require('../../database');

const api = request(app);
let dbUri;

const program1 = generateProgram();
const seededTicket = generateTicket({
  programId: program1._id,
  requesterId: admin._id
});

beforeAll(async () => {
  dbUri = await connect();
});
afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});
beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const TicketModel = db.model('Ticket', ticketSchema);
  const ProgramModel = db.model('Program', programSchema);
  await UserModel.deleteMany();
  await TicketModel.deleteMany();
  await ProgramModel.deleteMany();
  await UserModel.insertMany(users);
  await ProgramModel.insertMany([program1]);
  await TicketModel.insertMany([seededTicket]);
  protect.mockImplementation((req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/tickets (full stack)', () => {
  it('returns the seeded ticket as an array', async () => {
    const resp = await api.get('/api/tickets').set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(1);
    expect(resp.body.data[0]._id.toString()).toBe(seededTicket._id.toString());
  });

  it('filters by status', async () => {
    const resp = await api
      .get('/api/tickets?status=resolved')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // seeded ticket is "open", so a "resolved" filter returns nothing.
    expect(resp.body.data).toHaveLength(0);
  });
});

describe('POST /api/tickets (full stack)', () => {
  it('persists a new ticket and it is visible on a subsequent read', async () => {
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
    // controller stamps requester_id from req.user.
    expect(post.body.data.requester_id.toString()).toBe(admin._id.toString());

    const get = await api.get('/api/tickets').set('tenantId', TENANT_ID);
    // Both the seeded ticket and the newly-created one are now persisted.
    expect(get.body.data).toHaveLength(2);
    const descriptions = get.body.data.map((t) => t.description);
    expect(descriptions).toContain('new ticket from integration test');
  });
});

describe('PUT /api/tickets/:ticket_id (full stack)', () => {
  it('updates the ticket and the change is persisted', async () => {
    const put = await api
      .put(`/api/tickets/${seededTicket._id}`)
      .set('tenantId', TENANT_ID)
      .send({ status: 'in_progress' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.data.status).toBe('in_progress');
  });
});

describe('DELETE /api/tickets/:ticket_id (full stack)', () => {
  it('removes the ticket from the database', async () => {
    const del = await api
      .delete(`/api/tickets/${seededTicket._id}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await api.get('/api/tickets').set('tenantId', TENANT_ID);
    expect(get.body.data).toHaveLength(0);
  });
});
