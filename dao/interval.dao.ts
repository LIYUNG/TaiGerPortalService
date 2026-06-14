import { Interval } from '../models';

/**
 * IntervalDAO — data access for the Interval model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const IntervalDAO = {
  async bulkWrite(operations) {
    return Interval.bulkWrite(operations);
  },

  // All intervals with thread + student populated (response-time grouping).
  async findAllPopulated() {
    return Interval.find().populate('thread_id student_id').lean();
  },

  // Intervals matching `filter`, projected for the response-interval report.
  async findForReport(filter) {
    return Interval.find(filter).select('-updatedAt -_id -student_id').lean();
  }
};

module.exports = IntervalDAO;
