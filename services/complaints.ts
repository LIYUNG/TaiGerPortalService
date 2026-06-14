import ComplaintDAO from '../dao/complaint.dao';

/**
 * ComplaintService — business layer for customer-center complaint tickets.
 * Delegates data access to the DAO (controller -> service -> dao).
 */
const ComplaintService = {
  getComplaintsByRequester(requesterId) {
    return ComplaintDAO.getComplaintsByRequester(requesterId);
  },

  getComplaints(query) {
    return ComplaintDAO.getComplaints(query);
  },

  findComplaintsSelect(filter, select, limit) {
    return ComplaintDAO.findComplaintsSelect(filter, select, limit);
  },

  getComplaintByIdPopulated(ticketId) {
    return ComplaintDAO.getComplaintByIdPopulated(ticketId);
  },

  createComplaint(ticket) {
    return ComplaintDAO.createComplaint(ticket);
  },

  getComplaintDocByIdWithRequester(ticketId) {
    return ComplaintDAO.getComplaintDocByIdWithRequester(ticketId);
  },

  getComplaintByIdWithMessages(ticketId) {
    return ComplaintDAO.getComplaintByIdWithMessages(ticketId);
  },

  updateComplaintById(ticketId, fields) {
    return ComplaintDAO.updateComplaintById(ticketId, fields);
  },

  getComplaintDocById(ticketId) {
    return ComplaintDAO.getComplaintDocById(ticketId);
  },

  updateComplaintRaw(ticketId, payload) {
    return ComplaintDAO.updateComplaintRaw(ticketId, payload);
  },

  pullMessageById(ticketId, messageId) {
    return ComplaintDAO.pullMessageById(ticketId, messageId);
  },

  deleteComplaintById(ticketId) {
    return ComplaintDAO.deleteComplaintById(ticketId);
  }
};

module.exports = ComplaintService;
