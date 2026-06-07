// DB-free controller test: the DAO layer is mocked, so no MongoDB is touched.
// The real service (services/audit.js) runs and delegates to the mocked DAO.
// Query/aggregation behaviour is covered separately in __tests__/dao/audit.dao.test.js.
const passthrough = async (req, res, next) => next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(async (req, res, next) => {
    req.tenantId = 'test';
    next();
  }),
  // No real DB: stub req.db so nothing tries to open a connection.
  tenantMiddleware: jest.fn(async (req, res, next) => {
    req.db = { model: () => ({}) };
    next();
  })
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

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => ({
  ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
  InnerTaigerMultitenantFilter: jest.fn(passthrough)
}));

jest.mock('../../middlewares/permission-filter', () => ({
  ...jest.requireActual('../../middlewares/permission-filter'),
  permission_canAccessStudentDatabase_filter: jest.fn(passthrough)
}));

jest.mock('../../middlewares/multitenant-filter', () => ({
  ...jest.requireActual('../../middlewares/multitenant-filter'),
  multitenant_filter: jest.fn(passthrough)
}));

jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn(passthrough)
}));

// The data-access layer is mocked — this is what keeps the test DB-free.
jest.mock('../../dao/audit.dao', () => ({
  getAuditLogs: jest.fn().mockResolvedValue([]),
  createAuditLog: jest.fn().mockResolvedValue({})
}));

const request = require('supertest');
const { app } = require('../../app');
const { protect } = require('../../middlewares/auth');
const AuditDAO = require('../../dao/audit.dao');

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = { role: 'Admin', _id: 'u1' };
    next();
  });
});

describe('getAuditLogs Controller', () => {
  it('GET /api/audit/ returns 200 with the DAO result', async () => {
    AuditDAO.getAuditLogs.mockResolvedValueOnce([{ _id: 'a1', action: 'X' }]);

    const resp = await requestWithSupertest
      .get('/api/audit/')
      .set('tenantId', 'test');

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual([{ _id: 'a1', action: 'X' }]);
    expect(AuditDAO.getAuditLogs).toHaveBeenCalledTimes(1);
  });

  it('passes pagination/sort options through to the DAO', async () => {
    await requestWithSupertest
      .get('/api/audit/?page=2&limit=5&sortBy=createdAt&sortOrder=asc')
      .set('tenantId', 'test');

    const [, options] = AuditDAO.getAuditLogs.mock.calls[0];
    expect(options).toMatchObject({
      limit: 5,
      skip: 5,
      sort: { createdAt: 1 }
    });
  });
});
