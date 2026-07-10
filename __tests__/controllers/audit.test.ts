// Controller UNIT test for controllers/audit.
//
// getAuditLogs is a plain (req, res, next) function (wrapped by asyncHandler),
// so we call it DIRECTLY with fake req/res/next and a mocked AuditService. No
// route, no middleware, no database. We assert ONLY the controller's own work:
// the filter + options it builds (via the real UserQueryBuilder from the query
// string) and forwards to the service, the status + body it writes, and that a
// service error is forwarded to next(). Full-stack wiring lives in
// __tests__/integration/audit.test.js.

jest.mock('../../services/audit');

import AuditServiceReal from '../../services/audit';
import { getAuditLogs as getAuditLogsReal } from '../../controllers/audit';
import { mockReq, mockRes } from '../helpers/httpMocks';

const AuditService = AuditServiceReal as unknown as Record<string, jest.Mock>;
const getAuditLogs = getAuditLogsReal as unknown as (
  ...args: any[]
) => Promise<void>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAuditLogs', () => {
  it('responds 200 with the audit logs the service resolves', async () => {
    const logs = [{ _id: 'a1', action: 'X' }];
    AuditService.getAuditLogs.mockResolvedValue(logs);
    const res = mockRes();

    await getAuditLogs(mockReq({ query: {} }), res, jest.fn());

    expect(AuditService.getAuditLogs).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: logs });
  });

  it('passes pagination/sort options (built by UserQueryBuilder) to the service', async () => {
    AuditService.getAuditLogs.mockResolvedValue([]);
    const req = mockReq({
      query: { page: '2', limit: '5', sortBy: 'createdAt', sortOrder: 'asc' }
    });

    await getAuditLogs(req, mockRes(), jest.fn());

    const [filter, options] = AuditService.getAuditLogs.mock.calls[0];
    expect(filter).toEqual({});
    expect(options).toMatchObject({
      limit: 5,
      skip: 5, // page 2 * limit 5
      sort: { createdAt: 1 } // asc
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    AuditService.getAuditLogs.mockRejectedValue(err);
    const next = jest.fn();

    await getAuditLogs(mockReq({ query: {} }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
