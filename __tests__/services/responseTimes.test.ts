// ResponseTimeService is a set of thin pass-throughs to ResponseTimeDAO. This
// is a UNIT test: the DAO is mocked so no database is touched. Note the
// get*Populated methods map onto differently-named DAO find*Populated methods.
jest.mock('../../dao/responseTime.dao');

import type { AnyBulkWriteOperation } from 'mongoose';
import type { IResponseTime } from '@taiger-common/model';
import ResponseTimeDAOModule from '../../dao/responseTime.dao';
import ResponseTimeService from '../../services/responseTimes';

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so the
// per-test `.mockResolvedValue()` calls type-check while still allowing
// partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ResponseTimeDAO = ResponseTimeDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ResponseTimeService.bulkWrite (mocked DAO)', () => {
  it('delegates to DAO.bulkWrite with operations and returns its result', async () => {
    const operations = [
      { updateOne: {} }
    ] as unknown as AnyBulkWriteOperation<IResponseTime>[];
    const daoResult = { ok: 1, nModified: 1 };
    ResponseTimeDAO.bulkWrite.mockResolvedValue(daoResult);

    const result = await ResponseTimeService.bulkWrite(operations);

    expect(ResponseTimeDAO.bulkWrite).toHaveBeenCalledTimes(1);
    expect(ResponseTimeDAO.bulkWrite).toHaveBeenCalledWith(operations);
    expect(result).toBe(daoResult);
  });
});

describe('ResponseTimeService.findByStudentId (mocked DAO)', () => {
  it('delegates to DAO.findByStudentId with studentId and returns its result', async () => {
    const studentId = 's1';
    const daoResult = { _id: 'rt1', student: 's1' };
    ResponseTimeDAO.findByStudentId.mockResolvedValue(daoResult);

    const result = await ResponseTimeService.findByStudentId(studentId);

    expect(ResponseTimeDAO.findByStudentId).toHaveBeenCalledTimes(1);
    expect(ResponseTimeDAO.findByStudentId).toHaveBeenCalledWith(studentId);
    expect(result).toBe(daoResult);
  });
});

describe('ResponseTimeService.getForCommunicationPopulated (mocked DAO)', () => {
  it('delegates to DAO.findForCommunicationPopulated with no args', async () => {
    const daoResult = [{ _id: 'rt1' }];
    ResponseTimeDAO.findForCommunicationPopulated.mockResolvedValue(daoResult);

    const result = await ResponseTimeService.getForCommunicationPopulated();

    expect(ResponseTimeDAO.findForCommunicationPopulated).toHaveBeenCalledTimes(
      1
    );
    expect(
      ResponseTimeDAO.findForCommunicationPopulated
    ).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('ResponseTimeService.getForThreadPopulated (mocked DAO)', () => {
  it('delegates to DAO.findForThreadPopulated with no args', async () => {
    const daoResult = [{ _id: 'rt2' }];
    ResponseTimeDAO.findForThreadPopulated.mockResolvedValue(daoResult);

    const result = await ResponseTimeService.getForThreadPopulated();

    expect(ResponseTimeDAO.findForThreadPopulated).toHaveBeenCalledTimes(1);
    expect(ResponseTimeDAO.findForThreadPopulated).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});
