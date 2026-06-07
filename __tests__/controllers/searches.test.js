// DB-free controller test: the search DAO is mocked, so no MongoDB is touched.
// The real SearchService runs and delegates to the mocked DAO. Query behaviour
// is covered in __tests__/dao/search.dao.test.js.
const passthrough = async (req, res, next) => next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(async (req, res, next) => {
    req.tenantId = 'test';
    next();
  }),
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

jest.mock('../../dao/search.dao', () => ({
  searchPublicDocumentations: jest.fn().mockResolvedValue([]),
  searchUsers: jest.fn().mockResolvedValue([]),
  searchDocumentations: jest.fn().mockResolvedValue([]),
  searchInternaldocs: jest.fn().mockResolvedValue([]),
  searchPrograms: jest.fn().mockResolvedValue([]),
  searchStudentsByName: jest.fn().mockResolvedValue([])
}));

const request = require('supertest');
const { app } = require('../../app');
const { protect } = require('../../middlewares/auth');
const SearchDAO = require('../../dao/search.dao');

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = { role: 'Admin', _id: 'u1' };
    next();
  });
});

describe('GET /api/search/', () => {
  it('combines + sorts the DAO results by text score', async () => {
    SearchDAO.searchUsers.mockResolvedValueOnce([
      { firstname: 'Mid', score: 2 }
    ]);
    SearchDAO.searchDocumentations.mockResolvedValueOnce([
      { title: 'Top', score: 5 }
    ]);
    SearchDAO.searchPrograms.mockResolvedValueOnce([
      { program_name: 'Low', score: 1 }
    ]);

    const resp = await requestWithSupertest
      .get('/api/search/')
      .query({ q: 'test' })
      .set('tenantId', 'test');

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.map((d) => d.score)).toEqual([5, 2, 1]);
    expect(SearchDAO.searchUsers).toHaveBeenCalledWith('test');
  });
});

describe('GET /api/search/students', () => {
  it('returns the student DAO results', async () => {
    SearchDAO.searchStudentsByName.mockResolvedValueOnce([
      { firstname: 'Jane', role: 'Student' }
    ]);

    const resp = await requestWithSupertest
      .get('/api/search/students')
      .query({ q: 'jane' })
      .set('tenantId', 'test');

    expect(resp.status).toBe(200);
    expect(resp.body.data).toHaveLength(1);
    expect(SearchDAO.searchStudentsByName).toHaveBeenCalledWith('jane');
  });
});
