// DAO-level integration test for TicketDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Ticket } = require('../../models');
const TicketDAO = require('../../dao/ticket.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users } = require('../mock/user');
const {
  programTickets,
  programTicket1,
  programTicket2
} = require('../mock/tickets');
const { program1 } = require('../mock/programs');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Ticket.deleteMany({});
  await Ticket.insertMany(programTickets);
});

describe('TicketDAO (in-memory)', () => {
  it('getTickets filters by type + status', async () => {
    const res = await TicketDAO.getTickets({ type: 'program', status: 'open' });
    expect(res).toHaveLength(3);
  });

  it('getTickets filters by program_id', async () => {
    const res = await TicketDAO.getTickets({
      type: 'program',
      program_id: program1._id
    });
    expect(res).toHaveLength(2);
  });

  it('createTicket inserts a ticket', async () => {
    const created = await TicketDAO.createTicket({
      description: 'new ticket',
      requester_id: users[0]._id,
      program_id: program1._id
    });
    expect(created._id).toBeDefined();
    expect(created.description).toBe('new ticket');
  });

  it('updateTicketById applies the update and returns the new doc', async () => {
    const updated = await TicketDAO.updateTicketById(programTicket1._id, {
      description: 'updated-desc'
    });
    expect(updated.description).toBe('updated-desc');
  });

  it('deleteTicketById removes the ticket', async () => {
    await TicketDAO.deleteTicketById(programTicket2._id);
    expect(await Ticket.countDocuments({ _id: programTicket2._id })).toBe(0);
  });
});
