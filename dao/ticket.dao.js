const { Ticket } = require('../models');

/**
 * TicketDAO — data access for the Ticket model (central default-connection
 * model). Plain params, no req.
 */
const TicketDAO = {
  async getTickets(query, { populateRequester = false } = {}) {
    const cursor = Ticket.find(query).populate(
      'program_id',
      'school program_name degree'
    );
    if (populateRequester) {
      cursor.populate('requester_id', 'firstname lastname email');
    }
    return cursor.sort({ createdAt: -1 });
  },

  async createTicket(data) {
    return Ticket.create(data);
  },

  async updateTicketById(id, fields) {
    return Ticket.findByIdAndUpdate(id, fields, { new: true })
      .populate('requester_id', 'firstname lastname email archiv')
      .populate('program_id', 'school program_name degree semester');
  },

  async deleteTicketById(id) {
    return Ticket.findByIdAndDelete(id);
  }
};

module.exports = TicketDAO;
