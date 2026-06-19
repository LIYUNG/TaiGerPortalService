import { AnyBulkWriteOperation, FilterQuery } from 'mongoose';
import { IInterval } from '@taiger-common/model';
import { Interval } from '../models';

/**
 * IntervalDAO — data access for the Interval model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const IntervalDAO = {
  async bulkWrite(operations: AnyBulkWriteOperation<IInterval>[]) {
    return Interval.bulkWrite(operations);
  },

  // All intervals with thread + student populated (response-time grouping).
  async findAllPopulated() {
    return Interval.find().populate('thread_id student_id').lean();
  },

  // Intervals matching `filter`, projected for the response-interval report.
  async findForReport(filter: FilterQuery<IInterval>) {
    return Interval.find(filter).select('-updatedAt -_id -student_id').lean();
  }
};

export = IntervalDAO;
