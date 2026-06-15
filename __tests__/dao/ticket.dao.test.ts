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
    deleteMany: jest.fn(),
    aggregate: jest.fn()
  });
  return {
    Ticket: model()
  };
});

import { Ticket } from '../../models';
import TicketDAO from '../../dao/ticket.dao';

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

describe('TicketDAO.getTicketsOverview (mocked aggregate)', () => {
  it('builds a faceted pipeline with type/status match and unwraps data + total', async () => {
    const docs = [{ _id: 't1' }, { _id: 't2' }];
    Ticket.aggregate.mockResolvedValue([{ data: docs, total: [{ count: 7 }] }]);

    const res = await TicketDAO.getTicketsOverview({
      filters: { type: 'program', status: 'open' },
      search: '',
      skip: 20,
      limit: 10,
      sort: { createdAt: -1 }
    });

    expect(res).toEqual({ tickets: docs, total: 7 });
    const [pipeline] = Ticket.aggregate.mock.calls[0];
    // First stage matches the supplied filters.
    expect(pipeline[0]).toEqual({
      $match: { type: 'program', status: 'open' }
    });
    // Joins program + requester.
    const lookups = pipeline.filter((s) => s.$lookup);
    expect(lookups.map((s) => s.$lookup.from)).toEqual(['programs', 'users']);
    // Facet carries the pagination (sort/skip/limit) + count.
    const facet = pipeline.find((s) => s.$facet);
    expect(facet.$facet.data).toEqual([
      { $sort: { createdAt: -1 } },
      { $skip: 20 },
      { $limit: 10 }
    ]);
    expect(facet.$facet.total).toEqual([{ $count: 'count' }]);
    // No search => no extra $or match stage before the facet.
    expect(pipeline.some((s) => s.$match && s.$match.$or)).toBe(false);
  });

  it('adds a case-insensitive $or search across program + requester + description', async () => {
    Ticket.aggregate.mockResolvedValue([{ data: [], total: [] }]);

    const res = await TicketDAO.getTicketsOverview({
      filters: { type: 'program' },
      search: 'mit'
    });

    // Empty total facet => total 0.
    expect(res).toEqual({ tickets: [], total: 0 });
    const [pipeline] = Ticket.aggregate.mock.calls[0];
    const searchStage = pipeline.find((s) => s.$match && s.$match.$or);
    expect(searchStage).toBeDefined();
    const fields = searchStage.$match.$or.map((c) => Object.keys(c)[0]);
    expect(fields).toEqual([
      'description',
      'program_id.school',
      'program_id.program_name',
      'requester_id.firstname',
      'requester_id.lastname',
      'requester_id.email'
    ]);
    expect(searchStage.$match.$or[0].description).toEqual({
      $regex: 'mit',
      $options: 'i'
    });
  });

  it('escapes regex metacharacters in the search term', async () => {
    Ticket.aggregate.mockResolvedValue([{ data: [], total: [{ count: 0 }] }]);

    await TicketDAO.getTicketsOverview({ search: 'a.b*c' });

    const [pipeline] = Ticket.aggregate.mock.calls[0];
    const searchStage = pipeline.find((s) => s.$match && s.$match.$or);
    expect(searchStage.$match.$or[0].description.$regex).toBe('a\\.b\\*c');
  });
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
