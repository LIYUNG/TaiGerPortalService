// AuditService methods are thin pass-throughs to AuditDAO. This is a UNIT test:
// the DAO is mocked so no database (in-memory or otherwise) is touched. Each
// test asserts the service delegates to the right DAO method with the exact
// args and returns the DAO's (mocked) value.
jest.mock('../../dao/audit.dao');

import AuditDAOModule from '../../dao/audit.dao';
import AuditService from '../../services/audit';

// Auto-mocked DAO exposes jest.fn()s at runtime, but TS still sees the real
// signatures. Re-type it as a bag of jest.Mock methods so the per-test
// `.mockReturnValue()` calls type-check.
type MockedDAO = Record<string, jest.Mock>;
const AuditDAO = AuditDAOModule as unknown as MockedDAO;

// Real param type of the second arg, so the (intentionally partial) options
// fixture below can be passed without changing its field values.
type AuditLogsOptions = Parameters<typeof AuditService.getAuditLogs>[1];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuditService.getAuditLogs (mocked DAO)', () => {
  it('delegates to DAO.getAuditLogs with filter+options and returns its result', () => {
    const filter = { userId: 'u1' };
    const options = {
      limit: 10,
      sort: { createdAt: -1 }
    } as unknown as AuditLogsOptions;
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
