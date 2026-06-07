const TicketDAO = require('../dao/ticket.dao');

/**
 * TicketService — business layer for tickets. Delegates data access to the DAO
 * (controller -> service -> dao).
 */
const TicketService = {
  getTickets(query, options) {
    return TicketDAO.getTickets(query, options);
  },

  createTicket(data) {
    return TicketDAO.createTicket(data);
  },

  updateTicketById(id, fields) {
    return TicketDAO.updateTicketById(id, fields);
  },

  deleteTicketById(id) {
    return TicketDAO.deleteTicketById(id);
  }
};

module.exports = TicketService;
