import { FilterQuery, UpdateQuery } from 'mongoose';
import { IComplaint } from '@taiger-common/model';
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
  async getComplaintsByRequester(requesterId: string) {
    return Complaint.find({ requester_id: requesterId })
      .populate(...REQUESTER_POPULATE)
      .sort({ createdAt: -1 });
  },

  async getComplaints(query: FilterQuery<IComplaint>) {
    return Complaint.find(query)
      .populate(...REQUESTER_POPULATE)
      .sort({ createdAt: -1 });
  },

  // Slim select + cap lean read (AI-assist support-ticket context).
  async findComplaintsSelect(
    filter: FilterQuery<IComplaint>,
    select: string,
    limit: number
  ) {
    return Complaint.find(filter).select(select).limit(limit).lean();
  },

  async getComplaintByIdPopulated(ticketId: string) {
    return Complaint.findById(ticketId)
      .populate('messages.user_id', 'firstname lastname email pictureUrl')
      .populate('requester_id', 'firstname lastname email pictureUrl');
  },

  async createComplaint(ticket: Partial<IComplaint>) {
    return Complaint.create(ticket);
  },

  // Live (non-lean) document with requester populated — caller mutates messages
  // and calls .save().
  async getComplaintDocByIdWithRequester(ticketId: string) {
    return Complaint.findById(ticketId).populate('requester_id');
  },

  async getComplaintByIdWithMessages(ticketId: string) {
    return Complaint.findById(ticketId).populate(
      'requester_id messages.user_id'
    );
  },

  async updateComplaintById(ticketId: string, fields: UpdateQuery<IComplaint>) {
    return Complaint.findByIdAndUpdate(ticketId, fields, {
      new: true
    }).populate('requester_id', 'firstname lastname email archiv pictureUrl');
  },

  // Live (non-lean) document for the message ownership checks.
  async getComplaintDocById(ticketId: string) {
    return Complaint.findById(ticketId);
  },

  async updateComplaintRaw(ticketId: string, payload: UpdateQuery<IComplaint>) {
    return Complaint.findByIdAndUpdate(ticketId, payload, { upsert: false });
  },

  async pullMessageById(ticketId: string, messageId: string) {
    return Complaint.findByIdAndUpdate(ticketId, {
      $pull: {
        messages: { _id: messageId }
      }
    });
  },

  async deleteComplaintById(ticketId: string) {
    return Complaint.findByIdAndDelete(ticketId);
  }
};

export = ComplaintDAO;
