import { FilterQuery, UpdateQuery, SortOrder, Types } from 'mongoose';
import { ICommunication } from '@taiger-common/model';
import CommunicationDAO from '../dao/communication.dao';

/**
 * CommunicationService — business layer; delegates data access to the DAO
 * (controller -> service -> dao).
 */
const CommunicationService = {
  getCommunicationByStudentId(studentId: string) {
    return CommunicationDAO.getCommunicationByStudentId(studentId);
  },

  getCommunicationById(communicationId: string) {
    return CommunicationDAO.getCommunicationById(communicationId);
  },

  getCommunications(query: FilterQuery<ICommunication>) {
    return CommunicationDAO.getCommunications(query);
  },

  getAllForIntervalGrouping() {
    return CommunicationDAO.getAllForIntervalGrouping();
  },

  findPopulatedSorted(
    filter: FilterQuery<ICommunication>,
    options?: { sort?: Record<string, SortOrder>; limit?: number }
  ) {
    return CommunicationDAO.findPopulatedSorted(filter, options);
  },

  getByStudentIdForExport(studentId: string) {
    return CommunicationDAO.getByStudentIdForExport(studentId);
  },

  getRecentByStudentId(studentId: string, limit: number) {
    return CommunicationDAO.getRecentByStudentId(studentId, limit);
  },

  updateCommunication(
    communicationId: string,
    payload: UpdateQuery<ICommunication>
  ) {
    return CommunicationDAO.updateCommunication(communicationId, payload);
  },

  createCommunication(payload: Partial<ICommunication>) {
    return CommunicationDAO.createCommunication(payload);
  },

  deleteById(communicationId: string) {
    return CommunicationDAO.deleteById(communicationId);
  },

  getLatestByStudentId(studentId: string) {
    return CommunicationDAO.getLatestByStudentId(studentId);
  },

  getLatestMessageAtForStudents(studentIds: Types.ObjectId[]) {
    return CommunicationDAO.getLatestMessageAtForStudents(studentIds);
  },

  getUnansweredStudentMessages(studentIds: Types.ObjectId[]) {
    return CommunicationDAO.getUnansweredStudentMessages(studentIds);
  },

  findThreadPopulated(
    studentId: string,
    options?: {
      populate?: string;
      select?: string;
      skip?: number;
      limit?: number;
      lean?: boolean;
    }
  ) {
    return CommunicationDAO.findThreadPopulated(studentId, options);
  },

  searchThread(studentId: string, q: string, options?: { limit?: number }) {
    return CommunicationDAO.searchThread(studentId, q, options);
  },

  getThreadContext(
    studentId: string,
    messageId: string,
    options?: { before?: number; after?: number }
  ) {
    return CommunicationDAO.getThreadContext(studentId, messageId, options);
  },

  getAdjacentMessages(
    studentId: string,
    messageId: string,
    direction: string,
    limit?: number
  ) {
    return CommunicationDAO.getAdjacentMessages(
      studentId,
      messageId,
      direction,
      limit
    );
  }
};

export = CommunicationService;
