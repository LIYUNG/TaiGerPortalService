import { FilterQuery, UpdateQuery } from 'mongoose';
import { IComplaint } from '@taiger-common/model';
import ComplaintDAO from '../dao/complaint.dao';

/**
 * ComplaintService — business layer for customer-center complaint tickets.
 * Delegates data access to the DAO (controller -> service -> dao).
 */
const ComplaintService = {
  getComplaintsByRequester(requesterId: string) {
    return ComplaintDAO.getComplaintsByRequester(requesterId);
  },

  getComplaints(query: FilterQuery<IComplaint>) {
    return ComplaintDAO.getComplaints(query);
  },

  findComplaintsSelect(
    filter: FilterQuery<IComplaint>,
    select: string,
    limit: number
  ) {
    return ComplaintDAO.findComplaintsSelect(filter, select, limit);
  },

  getComplaintByIdPopulated(ticketId: string) {
    return ComplaintDAO.getComplaintByIdPopulated(ticketId);
  },

  createComplaint(ticket: Partial<IComplaint>) {
    return ComplaintDAO.createComplaint(ticket);
  },

  getComplaintDocByIdWithRequester(ticketId: string) {
    return ComplaintDAO.getComplaintDocByIdWithRequester(ticketId);
  },

  getComplaintByIdWithMessages(ticketId: string) {
    return ComplaintDAO.getComplaintByIdWithMessages(ticketId);
  },

  updateComplaintById(ticketId: string, fields: UpdateQuery<IComplaint>) {
    return ComplaintDAO.updateComplaintById(ticketId, fields);
  },

  getComplaintDocById(ticketId: string) {
    return ComplaintDAO.getComplaintDocById(ticketId);
  },

  updateComplaintRaw(ticketId: string, payload: UpdateQuery<IComplaint>) {
    return ComplaintDAO.updateComplaintRaw(ticketId, payload);
  },

  pullMessageById(ticketId: string, messageId: string) {
    return ComplaintDAO.pullMessageById(ticketId, messageId);
  },

  deleteComplaintById(ticketId: string) {
    return ComplaintDAO.deleteComplaintById(ticketId);
  }
};

export = ComplaintService;
