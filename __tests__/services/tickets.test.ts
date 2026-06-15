// TicketService is a thin pass-through to TicketDAO (controller -> service ->
// dao). This is a UNIT test: the DAO is mocked so no database (in-memory or
// otherwise) is touched. Each test asserts the service delegates to the right
// DAO method with the exact args and returns the DAO's result.
jest.mock('../../dao/ticket.dao');

import TicketDAO from '../../dao/ticket.dao';
import TicketService from '../../services/tickets';

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

  describe('getTicketsOverview', () => {
    it('parses page/limit/search/type/status into DAO args and echoes page/limit', async () => {
      TicketDAO.getTicketsOverview.mockResolvedValue({
        tickets: [{ _id: 'tk1' }],
        total: 42
      });

      const result = await TicketService.getTicketsOverview({
        page: '3',
        limit: '10',
        search: '  mit  ',
        type: 'program',
        status: 'open'
      });

      expect(TicketDAO.getTicketsOverview).toHaveBeenCalledWith({
        filters: { type: 'program', status: 'open' },
        search: 'mit',
        skip: 20,
        limit: 10,
        sort: { createdAt: -1 }
      });
      expect(result).toEqual({
        tickets: [{ _id: 'tk1' }],
        total: 42,
        page: 3,
        limit: 10
      });
    });

    it('falls back to defaults and omits empty filters', async () => {
      TicketDAO.getTicketsOverview.mockResolvedValue({ tickets: [], total: 0 });

      const result = await TicketService.getTicketsOverview({});

      expect(TicketDAO.getTicketsOverview).toHaveBeenCalledWith({
        filters: {},
        search: '',
        skip: 0,
        limit: 20,
        sort: { createdAt: -1 }
      });
      expect(result).toEqual({ tickets: [], total: 0, page: 1, limit: 20 });
    });

    it('maps a whitelisted sortBy/sortOrder to the joined field', async () => {
      TicketDAO.getTicketsOverview.mockResolvedValue({ tickets: [], total: 0 });

      await TicketService.getTicketsOverview({
        sortBy: 'program',
        sortOrder: 'asc'
      });

      expect(TicketDAO.getTicketsOverview).toHaveBeenCalledWith(
        expect.objectContaining({ sort: { 'program_id.school': 1 } })
      );
    });

    it('falls back to createdAt desc for an unknown sortBy', async () => {
      TicketDAO.getTicketsOverview.mockResolvedValue({ tickets: [], total: 0 });

      await TicketService.getTicketsOverview({ sortBy: 'evil; drop' });

      expect(TicketDAO.getTicketsOverview).toHaveBeenCalledWith(
        expect.objectContaining({ sort: { createdAt: -1 } })
      );
    });

    it('caps limit at 100', async () => {
      TicketDAO.getTicketsOverview.mockResolvedValue({ tickets: [], total: 0 });

      await TicketService.getTicketsOverview({ limit: '5000' });

      expect(TicketDAO.getTicketsOverview).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });
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
