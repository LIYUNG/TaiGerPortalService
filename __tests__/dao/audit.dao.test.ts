// AuditDAO unit tests — the DAO is a thin query-building layer over the Audit
// model, so we mock the model entirely (NO database, in-memory or otherwise).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result. Real query/pagination behaviour is covered by
// the integration suite (__tests__/integration).
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    create: jest.fn()
  });
  return {
    Audit: model()
  };
});

import { Audit } from '../../models';
import AuditDAO from '../../dao/audit.dao';

// A query chain that terminates in `.sort()` resolving to `value`. Intermediate
// builder calls (populate/limit/skip) return the same chain so they compose.
const sortChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    sort: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuditDAO (mocked models)', () => {
  it('getAuditLogs forwards filter + limit/skip/sort options and returns the docs', async () => {
    const docs = [{ _id: 'a1', action: 'CREATE' }];
    const chain = sortChain(docs);
    Audit.find.mockReturnValue(chain);

    const filter = { action: 'CREATE' };
    const options = { limit: 10, skip: 0, sort: { createdAt: -1 } };
    const result = await AuditDAO.getAuditLogs(filter, options);

    expect(Audit.find).toHaveBeenCalledWith(filter);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toBe(docs);
  });

  it('createAuditLog forwards the payload to create and returns the doc', async () => {
    const created = { _id: 'a1', action: 'CREATE' };
    Audit.create.mockResolvedValue(created);

    const payload = { action: 'CREATE' };
    const result = await AuditDAO.createAuditLog(payload);

    expect(Audit.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });
});
