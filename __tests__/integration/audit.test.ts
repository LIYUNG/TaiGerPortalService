// Integration test for the audit route — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/audit ->
//   real AuditService -> MOCKED AuditDAO.
//
// These assert the controller passes the right filter/options (built by
// UserQueryBuilder from the query params) to the DAO and shapes the HTTP
// response from the DAO's (mocked) return. Fully deterministic — no database
// engine, no seeding.
import type { Request, Response, NextFunction } from 'express';

const passthrough = async (req: Request, res: Response, next: NextFunction) =>
  next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(
    async (req: Request, res: Response, next: NextFunction) => {
      req.tenantId = 'test';
      next();
    }
  )
}));

jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn(passthrough)
}));

jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn(passthrough),
  permit: jest.fn(() => passthrough)
}));

jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn(passthrough)
}));

// The data boundary: mock the DAO the audit service delegates to.
jest.mock('../../dao/audit.dao');

import request from 'supertest';

import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import AuditDAOModule from '../../dao/audit.dao';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;
type MockedDAO = Record<string, jest.Mock>;
const AuditDAO = AuditDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

const AUDIT_LOGS = [
  { action: 'create' },
  { action: 'update' },
  { action: 'delete' }
];

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = { role: 'Admin', _id: '012345678901234567891234' };
      next();
    }
  );
});

describe('GET /api/audit', () => {
  it('returns the audit logs from the DAO as an array', async () => {
    AuditDAO.getAuditLogs.mockResolvedValue(AUDIT_LOGS);

    const resp = await requestWithSupertest
      .get('/api/audit/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(3);
    // No query params -> UserQueryBuilder defaults: empty filter, limit 20.
    expect(AuditDAO.getAuditLogs).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ limit: 20, skip: 0 })
    );
  });

  it('passes the limit pagination param through to the DAO options', async () => {
    AuditDAO.getAuditLogs.mockResolvedValue(AUDIT_LOGS.slice(0, 2));

    const resp = await requestWithSupertest
      .get('/api/audit/?page=1&limit=2')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveLength(2);
    expect(AuditDAO.getAuditLogs).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ limit: 2, skip: 0 })
    );
  });
});
