import { AnyBulkWriteOperation, FilterQuery } from 'mongoose';
import { IInterval } from '@taiger-common/model';
import IntervalDAO from '../dao/interval.dao';

/**
 * IntervalService — business layer for response-interval records. Delegates
 * data access to the DAO (controller/util -> service -> dao).
 */
const IntervalService = {
  bulkWrite(operations: AnyBulkWriteOperation<IInterval>[]) {
    return IntervalDAO.bulkWrite(operations);
  },

  findAllPopulated() {
    return IntervalDAO.findAllPopulated();
  },

  findForReport(filter: FilterQuery<IInterval>) {
    return IntervalDAO.findForReport(filter);
  }
};

export = IntervalService;
