// ResponseTimeService is a set of thin pass-throughs to ResponseTimeDAO. This
// is a UNIT test: the DAO is mocked so no database is touched. Note the
// get*Populated methods map onto differently-named DAO find*Populated methods.
jest.mock('../../dao/responseTime.dao');

import ResponseTimeDAO from '../../dao/responseTime.dao';
import ResponseTimeService from '../../services/responseTimes';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ResponseTimeService.bulkWrite (mocked DAO)', () => {
  it('delegates to DAO.bulkWrite with operations and returns its result', async () => {
    const operations = [{ updateOne: {} }];
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
