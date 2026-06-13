const TicketDAO = require('../dao/ticket.dao');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Maps a client-facing column id to the (possibly joined) document field the
// aggregation can sort on. Anything outside this allow-list falls back to
// createdAt so a crafted sortBy can't sort on an arbitrary path.
const SORT_FIELD_MAP = {
  program: 'program_id.school',
  requester: 'requester_id.firstname',
  description: 'description',
  status: 'status',
  type: 'type',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

/**
 * TicketService — business layer for tickets. Delegates data access to the DAO
 * (controller -> service -> dao).
 */
const TicketService = {
  getTickets(query, options) {
    return TicketDAO.getTickets(query, options);
  },

  // Parses the raw query (page/limit/search/type/status) into safe pagination +
  // filters, asks the DAO for a page of joined tickets, and echoes the
  // normalized page/limit back so the caller can render pagination controls.
  async getTicketsOverview(query = {}) {
    const parsedPage = parseInt(query.page, 10);
    const parsedLimit = parseInt(query.limit, 10);
    const page = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
    const limit =
      parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

    const filters = {};
    if (query.type) {
      filters.type = String(query.type);
    }
    if (query.status) {
      filters.status = String(query.status);
    }

    const sortField = SORT_FIELD_MAP[query.sortBy] || 'createdAt';
    const sortOrder = String(query.sortOrder).toLowerCase() === 'asc' ? 1 : -1;

    const { tickets, total } = await TicketDAO.getTicketsOverview({
      filters,
      search: typeof query.search === 'string' ? query.search.trim() : '',
      skip: (page - 1) * limit,
      limit,
      sort: { [sortField]: sortOrder }
    });

    return { tickets, total, page, limit };
  },

  createTicket(data) {
    return TicketDAO.createTicket(data);
  },

  updateTicketById(id, fields) {
    return TicketDAO.updateTicketById(id, fields);
  },

  deleteTicketById(id) {
    return TicketDAO.deleteTicketById(id);
  },

  deleteTicketsByProgramId(programId) {
    return TicketDAO.deleteTicketsByProgramId(programId);
  }
};

module.exports = TicketService;
