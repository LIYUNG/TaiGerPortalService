// AuditService methods are thin pass-throughs to AuditDAO. This is a UNIT test:
// the DAO is mocked so no database (in-memory or otherwise) is touched. Each
// test asserts the service delegates to the right DAO method with the exact
// args and returns the DAO's (mocked) value.
jest.mock('../../dao/audit.dao');

import AuditDAO from '../../dao/audit.dao';
import AuditService from '../../services/audit';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuditService.getAuditLogs (mocked DAO)', () => {
  it('delegates to DAO.getAuditLogs with filter+options and returns its result', () => {
    const filter = { userId: 'u1' };
    const options = { limit: 10, sort: { createdAt: -1 } };
    const daoResult = [{ _id: 'a1' }];
    AuditDAO.getAuditLogs.mockReturnValue(daoResult);

    const result = AuditService.getAuditLogs(filter, options);

    expect(AuditDAO.getAuditLogs).toHaveBeenCalledTimes(1);
    expect(AuditDAO.getAuditLogs).toHaveBeenCalledWith(filter, options);
    expect(result).toBe(daoResult);
  });
});

describe('AuditService.createAuditLog (mocked DAO)', () => {
  it('delegates to DAO.createAuditLog with auditLog and returns its result', () => {
    const auditLog = { userId: 'u1', action: 'login' };
    const daoResult = { _id: 'a2', ...auditLog };
    AuditDAO.createAuditLog.mockReturnValue(daoResult);

    const result = AuditService.createAuditLog(auditLog);

    expect(AuditDAO.createAuditLog).toHaveBeenCalledTimes(1);
    expect(AuditDAO.createAuditLog).toHaveBeenCalledWith(auditLog);
    expect(result).toBe(daoResult);
  });
});
