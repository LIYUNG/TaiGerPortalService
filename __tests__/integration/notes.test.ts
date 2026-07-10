// Integration test for the notes routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/notes ->
//   real NoteService -> MOCKED NoteDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query construction is covered by the DAO unit tests
// (__tests__/dao/note.dao.test.js). Fully deterministic — no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

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
  decryptCookieMiddleware: jest.fn(
    (req: Request, res: Response, next: NextFunction) => next()
  )
}));
jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn((req: Request, res: Response, next: NextFunction) => next()),
  permit: jest.fn(
    () => (req: Request, res: Response, next: NextFunction) => next()
  )
}));
jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn(
    (req: Request, res: Response, next: NextFunction) => next()
  )
}));

// The data boundary: mock the DAO the note service delegates to.
jest.mock('../../dao/note.dao');

import NoteDAOModule from '../../dao/note.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, student } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;
type MockedDAO = Record<string, jest.Mock>;
const NoteDAO = NoteDAOModule as unknown as MockedDAO;

const api = request(app);
const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('GET /api/notes/:student_id', () => {
  it('returns the note record from the DAO, queried by student id', async () => {
    const note = { student_id: studentId, notes: 'Some note content' };
    NoteDAO.getNoteByStudentId.mockResolvedValue(note);

    const resp = await api
      .get(`/api/notes/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(NoteDAO.getNoteByStudentId).toHaveBeenCalledWith(studentId);
    expect(resp.body.data.student_id.toString()).toBe(studentId);
    expect(resp.body.data.notes).toBe('Some note content');
  });
});

describe('PUT /api/notes/:student_id', () => {
  it('upserts via the DAO with the posted fields and returns the saved record', async () => {
    const notes = 'Updated note content';
    const saved = { student_id: studentId, notes };
    NoteDAO.upsertNoteByStudentId.mockResolvedValue(saved);

    const put = await api
      .put(`/api/notes/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ notes });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    // The controller stamps student_id onto the fields before delegating.
    expect(NoteDAO.upsertNoteByStudentId).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({ notes, student_id: studentId })
    );
    expect(put.body.data.notes).toBe(notes);
  });
});
