import IntervalDAO from '../dao/interval.dao';

/**
 * IntervalService — business layer for response-interval records. Delegates
 * data access to the DAO (controller/util -> service -> dao).
 */
const IntervalService = {
  bulkWrite(operations) {
    return IntervalDAO.bulkWrite(operations);
  },

  findAllPopulated() {
    return IntervalDAO.findAllPopulated();
  },

  findForReport(filter) {
    return IntervalDAO.findForReport(filter);
  }
};

export = IntervalService;
