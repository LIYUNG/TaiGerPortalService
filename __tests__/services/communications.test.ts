// CommunicationService methods are thin pass-throughs to CommunicationDAO. This
// is a UNIT test: the DAO is mocked so no database (in-memory or otherwise) is
// touched. Each test asserts the service delegates to the right DAO method with
// the exact args and returns the DAO's (mocked) value.
jest.mock('../../dao/communication.dao');

import CommunicationDAO from '../../dao/communication.dao';
import CommunicationService from '../../services/communications';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunicationService.getCommunicationByStudentId (mocked DAO)', () => {
  it('delegates to DAO.getCommunicationByStudentId with studentId and returns its result', () => {
    const daoResult = [{ _id: 'm1' }];
    CommunicationDAO.getCommunicationByStudentId.mockReturnValue(daoResult);

    const result = CommunicationService.getCommunicationByStudentId('s1');

    expect(CommunicationDAO.getCommunicationByStudentId).toHaveBeenCalledTimes(
      1
    );
    expect(CommunicationDAO.getCommunicationByStudentId).toHaveBeenCalledWith(
      's1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.getCommunicationById (mocked DAO)', () => {
  it('delegates to DAO.getCommunicationById with communicationId and returns its result', () => {
    const daoResult = { _id: 'm1' };
    CommunicationDAO.getCommunicationById.mockReturnValue(daoResult);

    const result = CommunicationService.getCommunicationById('m1');

    expect(CommunicationDAO.getCommunicationById).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.getCommunicationById).toHaveBeenCalledWith('m1');
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.getCommunications (mocked DAO)', () => {
  it('delegates to DAO.getCommunications with query and returns its result', () => {
    const query = { page: '1', limit: '20' };
    const daoResult = { communications: [], total: 0 };
    CommunicationDAO.getCommunications.mockReturnValue(daoResult);

    const result = CommunicationService.getCommunications(query);

    expect(CommunicationDAO.getCommunications).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.getCommunications).toHaveBeenCalledWith(query);
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.getAllForIntervalGrouping (mocked DAO)', () => {
  it('delegates to DAO.getAllForIntervalGrouping and returns its result', () => {
    const daoResult = [{ _id: 'm1' }, { _id: 'm2' }];
    CommunicationDAO.getAllForIntervalGrouping.mockReturnValue(daoResult);

    const result = CommunicationService.getAllForIntervalGrouping();

    expect(CommunicationDAO.getAllForIntervalGrouping).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.getAllForIntervalGrouping).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.findPopulatedSorted (mocked DAO)', () => {
  it('delegates to DAO.findPopulatedSorted with filter+options and returns its result', () => {
    const filter = { student_id: 's1' };
    const options = { sort: { createdAt: -1 } };
    const daoResult = [{ _id: 'm1' }];
    CommunicationDAO.findPopulatedSorted.mockReturnValue(daoResult);

    const result = CommunicationService.findPopulatedSorted(filter, options);

    expect(CommunicationDAO.findPopulatedSorted).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.findPopulatedSorted).toHaveBeenCalledWith(
      filter,
      options
    );
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.getByStudentIdForExport (mocked DAO)', () => {
  it('delegates to DAO.getByStudentIdForExport with studentId and returns its result', () => {
    const daoResult = [{ _id: 'm1' }];
    CommunicationDAO.getByStudentIdForExport.mockReturnValue(daoResult);

    const result = CommunicationService.getByStudentIdForExport('s1');

    expect(CommunicationDAO.getByStudentIdForExport).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.getByStudentIdForExport).toHaveBeenCalledWith('s1');
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.getRecentByStudentId (mocked DAO)', () => {
  it('delegates to DAO.getRecentByStudentId with studentId+limit and returns its result', () => {
    const daoResult = [{ _id: 'm1' }];
    CommunicationDAO.getRecentByStudentId.mockReturnValue(daoResult);

    const result = CommunicationService.getRecentByStudentId('s1', 5);

    expect(CommunicationDAO.getRecentByStudentId).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.getRecentByStudentId).toHaveBeenCalledWith('s1', 5);
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.updateCommunication (mocked DAO)', () => {
  it('delegates to DAO.updateCommunication with communicationId+payload and returns its result', () => {
    const payload = { message: 'updated' };
    const daoResult = { _id: 'm1', ...payload };
    CommunicationDAO.updateCommunication.mockReturnValue(daoResult);

    const result = CommunicationService.updateCommunication('m1', payload);

    expect(CommunicationDAO.updateCommunication).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.updateCommunication).toHaveBeenCalledWith(
      'm1',
      payload
    );
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.createCommunication (mocked DAO)', () => {
  it('delegates to DAO.createCommunication with payload and returns its result', () => {
    const payload = { student_id: 's1', message: 'hi' };
    const daoResult = { _id: 'm2', ...payload };
    CommunicationDAO.createCommunication.mockReturnValue(daoResult);

    const result = CommunicationService.createCommunication(payload);

    expect(CommunicationDAO.createCommunication).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.createCommunication).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.deleteById (mocked DAO)', () => {
  it('delegates to DAO.deleteById with communicationId and returns its result', () => {
    const daoResult = { deletedCount: 1 };
    CommunicationDAO.deleteById.mockReturnValue(daoResult);

    const result = CommunicationService.deleteById('m1');

    expect(CommunicationDAO.deleteById).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.deleteById).toHaveBeenCalledWith('m1');
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.getLatestByStudentId (mocked DAO)', () => {
  it('delegates to DAO.getLatestByStudentId with studentId and returns its result', () => {
    const daoResult = { _id: 'm1' };
    CommunicationDAO.getLatestByStudentId.mockReturnValue(daoResult);

    const result = CommunicationService.getLatestByStudentId('s1');

    expect(CommunicationDAO.getLatestByStudentId).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.getLatestByStudentId).toHaveBeenCalledWith('s1');
    expect(result).toBe(daoResult);
  });
});

describe('CommunicationService.findThreadPopulated (mocked DAO)', () => {
  it('delegates to DAO.findThreadPopulated with studentId+options and returns its result', () => {
    const options = { limit: 20 };
    const daoResult = [{ _id: 'm1' }];
    CommunicationDAO.findThreadPopulated.mockReturnValue(daoResult);

    const result = CommunicationService.findThreadPopulated('s1', options);

    expect(CommunicationDAO.findThreadPopulated).toHaveBeenCalledTimes(1);
    expect(CommunicationDAO.findThreadPopulated).toHaveBeenCalledWith(
      's1',
      options
    );
    expect(result).toBe(daoResult);
  });
});
