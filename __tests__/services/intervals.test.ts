// IntervalService methods are thin pass-throughs to IntervalDAO. This is a UNIT
// test: the DAO is mocked so no database is touched. Each method is asserted to
// delegate to the matching DAO method with the exact args and to return the
// DAO's result unchanged.
jest.mock('../../dao/interval.dao');

import IntervalDAO from '../../dao/interval.dao';
import IntervalService from '../../services/intervals';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('IntervalService.bulkWrite (mocked DAO)', () => {
  it('delegates to DAO.bulkWrite and returns its result', async () => {
    const operations = [{ updateOne: { filter: {}, update: {} } }];
    const daoResult = { ok: 1, nModified: 1 };
    IntervalDAO.bulkWrite.mockResolvedValue(daoResult);

    const result = await IntervalService.bulkWrite(operations);

    expect(IntervalDAO.bulkWrite).toHaveBeenCalledTimes(1);
    expect(IntervalDAO.bulkWrite).toHaveBeenCalledWith(operations);
    expect(result).toBe(daoResult);
  });
});

describe('IntervalService.findAllPopulated (mocked DAO)', () => {
  it('delegates to DAO.findAllPopulated and returns its result', async () => {
    const daoResult = [{ _id: 'i1' }, { _id: 'i2' }];
    IntervalDAO.findAllPopulated.mockResolvedValue(daoResult);

    const result = await IntervalService.findAllPopulated();

    expect(IntervalDAO.findAllPopulated).toHaveBeenCalledTimes(1);
    expect(IntervalDAO.findAllPopulated).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('IntervalService.findForReport (mocked DAO)', () => {
  it('delegates to DAO.findForReport with filter and returns its result', async () => {
    const filter = { student_id: 's1' };
    const daoResult = [{ _id: 'i1', interval: 3 }];
    IntervalDAO.findForReport.mockResolvedValue(daoResult);

    const result = await IntervalService.findForReport(filter);

    expect(IntervalDAO.findForReport).toHaveBeenCalledTimes(1);
    expect(IntervalDAO.findForReport).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });
});
