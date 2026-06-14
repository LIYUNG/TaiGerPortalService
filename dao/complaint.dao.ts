import { Complaint } from '../models';

const REQUESTER_POPULATE = [
  'requester_id',
  'firstname lastname email pictureUrl'
];

/**
 * ComplaintDAO — data access for the Complaint model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const ComplaintDAO = {
  async getComplaintsByRequester(requesterId) {
    return Complaint.find({ requester_id: requesterId })
      .populate(...REQUESTER_POPULATE)
      .sort({ createdAt: -1 });
  },

  async getComplaints(query) {
    return Complaint.find(query)
      .populate(...REQUESTER_POPULATE)
      .sort({ createdAt: -1 });
  },

  // Slim select + cap lean read (AI-assist support-ticket context).
  async findComplaintsSelect(filter, select, limit) {
    return Complaint.find(filter).select(select).limit(limit).lean();
  },

  async getComplaintByIdPopulated(ticketId) {
    return Complaint.findById(ticketId)
      .populate('messages.user_id', 'firstname lastname email pictureUrl')
      .populate('requester_id', 'firstname lastname email pictureUrl');
  },

  async createComplaint(ticket) {
    return Complaint.create(ticket);
  },

  // Live (non-lean) document with requester populated — caller mutates messages
  // and calls .save().
  async getComplaintDocByIdWithRequester(ticketId) {
    return Complaint.findById(ticketId).populate('requester_id');
  },

  async getComplaintByIdWithMessages(ticketId) {
    return Complaint.findById(ticketId).populate(
      'requester_id messages.user_id'
    );
  },

  async updateComplaintById(ticketId, fields) {
    return Complaint.findByIdAndUpdate(ticketId, fields, {
      new: true
    }).populate('requester_id', 'firstname lastname email archiv pictureUrl');
  },

  // Live (non-lean) document for the message ownership checks.
  async getComplaintDocById(ticketId) {
    return Complaint.findById(ticketId);
  },

  async updateComplaintRaw(ticketId, payload) {
    return Complaint.findByIdAndUpdate(ticketId, payload, { upsert: false });
  },

  async pullMessageById(ticketId, messageId) {
    return Complaint.findByIdAndUpdate(ticketId, {
      $pull: {
        messages: { _id: messageId }
      }
    });
  },

  async deleteComplaintById(ticketId) {
    return Complaint.findByIdAndDelete(ticketId);
  }
};

module.exports = ComplaintDAO;
