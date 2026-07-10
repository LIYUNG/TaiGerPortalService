// Integration test for the search routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/search ->
//   real SearchService -> MOCKED SearchDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return (combine + sort by
// text score). The actual query/$text construction is covered by the DAO unit
// tests. Fully deterministic — no engine flake.

import type { Request, Response, NextFunction } from 'express';

const passthrough = (req: Request, res: Response, next: NextFunction) => next();

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(
    (req: Request, res: Response, next: NextFunction) => {
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

// The data boundary: mock the DAO the search service delegates to.
jest.mock('../../dao/search.dao');

import request from 'supertest';
import SearchDAOModule from '../../dao/search.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so the
// per-test `.mockResolvedValue()/.mockRejectedValue()` calls type-check while
// still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const SearchDAO = SearchDAOModule as unknown as MockedDAO;

const api = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('GET /api/search/students', () => {
  it('returns the students the DAO matches, sorted by score desc', async () => {
    const students = [
      { _id: 'a', firstname: 'Zephyrina', role: 'Student', score: 1 },
      { _id: 'b', firstname: 'Zephyron', role: 'Student', score: 5 }
    ];
    SearchDAO.searchStudentsByName.mockResolvedValue(students);

    const resp = await api
      .get('/api/search/students')
      .query({ q: 'zephyr' })
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(SearchDAO.searchStudentsByName).toHaveBeenCalledWith('zephyr');
    expect(Array.isArray(resp.body.data)).toBe(true);
    // Sorted by score desc by the service.
    expect(resp.body.data.map((u: { _id: string }) => u._id)).toEqual([
      'b',
      'a'
    ]);
  });

  it('returns an empty array when the DAO finds nothing', async () => {
    SearchDAO.searchStudentsByName.mockResolvedValue([]);

    const resp = await api
      .get('/api/search/students')
      .query({ q: 'zzzznomatchzzzz' })
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(SearchDAO.searchStudentsByName).toHaveBeenCalledWith(
      'zzzznomatchzzzz'
    );
    expect(resp.body.data).toEqual([]);
  });
});

describe('GET /api/search/', () => {
  it('combines all DAO result sets and sorts by score desc', async () => {
    SearchDAO.searchUsers.mockResolvedValue([
      { _id: 'u1', role: 'Student', score: 2 }
    ]);
    SearchDAO.searchDocumentations.mockResolvedValue([
      { _id: 'd1', title: 'Doc', score: 9 }
    ]);
    SearchDAO.searchInternaldocs.mockResolvedValue([
      { _id: 'i1', title: 'Internal', score: 4 }
    ]);
    SearchDAO.searchPrograms.mockResolvedValue([
      { _id: 'p1', school: 'School', score: 6 }
    ]);

    const resp = await api
      .get('/api/search/')
      .query({ q: 'a' })
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(SearchDAO.searchUsers).toHaveBeenCalledWith('a');
    expect(SearchDAO.searchDocumentations).toHaveBeenCalledWith('a');
    expect(SearchDAO.searchInternaldocs).toHaveBeenCalledWith('a');
    expect(SearchDAO.searchPrograms).toHaveBeenCalledWith('a');
    expect(Array.isArray(resp.body.data)).toBe(true);
    // students.concat(documentations, internaldocs, programs).sort(byScoreDesc)
    expect(resp.body.data.map((r: { _id: string }) => r._id)).toEqual([
      'd1',
      'p1',
      'i1',
      'u1'
    ]);
  });

  it('swallows a DAO error and still returns success with an empty array', async () => {
    SearchDAO.searchUsers.mockRejectedValue(new Error('text index missing'));
    SearchDAO.searchDocumentations.mockResolvedValue([]);
    SearchDAO.searchInternaldocs.mockResolvedValue([]);
    SearchDAO.searchPrograms.mockResolvedValue([]);

    const resp = await api
      .get('/api/search/')
      .query({ q: 'a' })
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual([]);
  });
});
