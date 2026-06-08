// TicketService is a thin pass-through to TicketDAO (controller -> service ->
// dao). This is a UNIT test: the DAO is mocked so no database (in-memory or
// otherwise) is touched. Each test asserts the service delegates to the right
// DAO method with the exact args and returns the DAO's result.
jest.mock('../../dao/ticket.dao');

const TicketDAO = require('../../dao/ticket.dao');
const TicketService = require('../../services/tickets');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TicketService (mocked DAO)', () => {
  it('getTickets delegates with query + options and returns its result', async () => {
    const query = { status: 'open' };
    const options = { sort: { createdAt: -1 } };
    const daoResult = [{ _id: 'tk1' }];
    TicketDAO.getTickets.mockResolvedValue(daoResult);

    const result = await TicketService.getTickets(query, options);

    expect(TicketDAO.getTickets).toHaveBeenCalledTimes(1);
    expect(TicketDAO.getTickets).toHaveBeenCalledWith(query, options);
    expect(result).toBe(daoResult);
  });

  it('createTicket delegates with data and returns its result', async () => {
    const data = { title: 'Missing transcript', programId: 'p1' };
    const daoResult = { _id: 'tk1', ...data };
    TicketDAO.createTicket.mockResolvedValue(daoResult);

    const result = await TicketService.createTicket(data);

    expect(TicketDAO.createTicket).toHaveBeenCalledTimes(1);
    expect(TicketDAO.createTicket).toHaveBeenCalledWith(data);
    expect(result).toBe(daoResult);
  });

  it('updateTicketById delegates with id + fields and returns its result', async () => {
    const fields = { status: 'closed' };
    const daoResult = { _id: 'tk1', status: 'closed' };
    TicketDAO.updateTicketById.mockResolvedValue(daoResult);

    const result = await TicketService.updateTicketById('tk1', fields);

    expect(TicketDAO.updateTicketById).toHaveBeenCalledTimes(1);
    expect(TicketDAO.updateTicketById).toHaveBeenCalledWith('tk1', fields);
    expect(result).toBe(daoResult);
  });

  it('deleteTicketById delegates with id and returns its result', async () => {
    const daoResult = { deletedCount: 1 };
    TicketDAO.deleteTicketById.mockResolvedValue(daoResult);

    const result = await TicketService.deleteTicketById('tk1');

    expect(TicketDAO.deleteTicketById).toHaveBeenCalledTimes(1);
    expect(TicketDAO.deleteTicketById).toHaveBeenCalledWith('tk1');
    expect(result).toBe(daoResult);
  });

  it('deleteTicketsByProgramId delegates with programId and returns its result', async () => {
    const daoResult = { deletedCount: 3 };
    TicketDAO.deleteTicketsByProgramId.mockResolvedValue(daoResult);

    const result = await TicketService.deleteTicketsByProgramId('p1');

    expect(TicketDAO.deleteTicketsByProgramId).toHaveBeenCalledTimes(1);
    expect(TicketDAO.deleteTicketsByProgramId).toHaveBeenCalledWith('p1');
    expect(result).toBe(daoResult);
  });
});
