import { AnyBulkWriteOperation } from 'mongoose';
import { IResponseTime } from '@taiger-common/model';
import ResponseTimeDAO from '../dao/responseTime.dao';

/**
 * ResponseTimeService — business layer for averaged response-time records.
 * Delegates data access to the DAO (controller/util -> service -> dao).
 */
const ResponseTimeService = {
  bulkWrite(operations: AnyBulkWriteOperation<IResponseTime>[]) {
    return ResponseTimeDAO.bulkWrite(operations);
  },

  findByStudentId(studentId: string) {
    return ResponseTimeDAO.findByStudentId(studentId);
  },

  getForCommunicationPopulated() {
    return ResponseTimeDAO.findForCommunicationPopulated();
  },

  getForThreadPopulated() {
    return ResponseTimeDAO.findForThreadPopulated();
  }
};

export = ResponseTimeService;
