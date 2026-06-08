// TicketDAO unit tests — the DAO is a thin query-building layer over the Ticket
// model, so we mock the models entirely (NO database, in-memory or otherwise).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result. Real query behaviour is covered by the
// integration suite (__tests__/integration), which runs against in-memory
// MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn()
  });
  return {
    Ticket: model()
  };
});

const { Ticket } = require('../../models');
const TicketDAO = require('../../dao/ticket.dao');

// A query chain whose terminal `.sort()` resolves to `value`. Intermediate
// builder calls (populate) return the same chain so they compose.
const sortChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

// A query chain whose terminal `.populate()` resolves to `value`. Each populate
// returns the same chain; the last one in the DAO is awaited, so we make the
// chain itself thenable.
const populateChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TicketDAO (mocked models)', () => {
  it('getTickets forwards the query, populates program_id and sorts desc', async () => {
    const docs = [{ _id: 't1' }, { _id: 't2' }];
    const chain = sortChain(docs);
    Ticket.find.mockReturnValue(chain);

    const query = { type: 'program', status: 'open' };
    const res = await TicketDAO.getTickets(query);

    expect(Ticket.find).toHaveBeenCalledWith(query);
    expect(chain.populate).toHaveBeenCalledWith(
      'program_id',
      'school program_name degree'
    );
    // requester is NOT populated unless requested
    expect(chain.populate).toHaveBeenCalledTimes(1);
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res).toBe(docs);
  });

  it('getTickets also populates requester_id when populateRequester is true', async () => {
    const docs = [{ _id: 't1' }];
    const chain = sortChain(docs);
    Ticket.find.mockReturnValue(chain);

    const query = { type: 'program' };
    const res = await TicketDAO.getTickets(query, { populateRequester: true });

    expect(Ticket.find).toHaveBeenCalledWith(query);
    expect(chain.populate).toHaveBeenCalledWith(
      'program_id',
      'school program_name degree'
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'requester_id',
      'firstname lastname email'
    );
    expect(chain.populate).toHaveBeenCalledTimes(2);
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res).toBe(docs);
  });

  it('createTicket forwards the data to Ticket.create and returns the doc', async () => {
    const data = { description: 'new ticket', requester_id: 'u1' };
    const created = { _id: 't9', description: 'new ticket' };
    Ticket.create.mockResolvedValue(created);

    const res = await TicketDAO.createTicket(data);

    expect(Ticket.create).toHaveBeenCalledWith(data);
    expect(res).toBe(created);
  });

  it('updateTicketById uses findByIdAndUpdate with { new: true } and populates', async () => {
    const updated = { _id: 't1', description: 'updated-desc' };
    const chain = populateChain(updated);
    Ticket.findByIdAndUpdate.mockReturnValue(chain);

    const fields = { description: 'updated-desc' };
    const res = await TicketDAO.updateTicketById('t1', fields);

    expect(Ticket.findByIdAndUpdate).toHaveBeenCalledWith('t1', fields, {
      new: true
    });
    expect(chain.populate).toHaveBeenCalledWith(
      'requester_id',
      'firstname lastname email archiv'
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'program_id',
      'school program_name degree semester'
    );
    expect(res).toBe(updated);
  });

  it('deleteTicketById forwards the id to findByIdAndDelete', async () => {
    const deleted = { _id: 't2' };
    Ticket.findByIdAndDelete.mockResolvedValue(deleted);

    const res = await TicketDAO.deleteTicketById('t2');

    expect(Ticket.findByIdAndDelete).toHaveBeenCalledWith('t2');
    expect(res).toBe(deleted);
  });

  it('deleteTicketsByProgramId removes all tickets for the program', async () => {
    const result = { deletedCount: 3 };
    Ticket.deleteMany.mockResolvedValue(result);

    const res = await TicketDAO.deleteTicketsByProgramId('p1');

    expect(Ticket.deleteMany).toHaveBeenCalledWith({ program_id: 'p1' });
    expect(res).toBe(result);
  });
});
