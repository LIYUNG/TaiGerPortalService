// Integration test for the student-applications routes — HTTP boundary down to
// the service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers ->
//   real ApplicationService / TeamService / ProgramService /
//   DocumentThreadService -> MOCKED ApplicationDAO / TeamDAO / ProgramDAO /
//   DocumentthreadDAO.
//
//   GET /conflicts -> controllers/student_applications.getApplicationConflicts
//   GET /deltas    -> controllers/teams.getApplicationDeltas
//
// These assert the controllers/services pass the right arguments to the DAOs and
// shape the HTTP response from the DAOs' (mocked) return. The aggregation
// construction itself is covered by the DAO unit tests. Fully deterministic — no
// engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);

// The data boundary: mock the DAOs the conflict + delta flows delegate to.
jest.mock('../../dao/application.dao');
jest.mock('../../dao/team.dao');
jest.mock('../../dao/program.dao');
jest.mock('../../dao/documentthread.dao');

import ApplicationDAOModule from '../../dao/application.dao';
import TeamDAOModule from '../../dao/team.dao';
import ProgramDAOModule from '../../dao/program.dao';
import DocumentthreadDAOModule from '../../dao/documentthread.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';
import { generateProgram, generateUser } from '../fixtures/faker';
import { Role } from '../../constants';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;
const TeamDAO = TeamDAOModule as unknown as MockedDAO;
const ProgramDAO = ProgramDAOModule as unknown as MockedDAO;
const DocumentthreadDAO = DocumentthreadDAOModule as unknown as MockedDAO;

const api = request(app);

const studentA = generateUser(Role.Student);
const studentB = generateUser(Role.Student);
const conflictProgram = generateProgram();

beforeEach(() => {
  jest.clearAllMocks();

  asMock(protect).mockImplementation(
    (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );

  // Sensible defaults; individual tests override as needed.
  ApplicationDAO.getApplicationConflicts.mockResolvedValue([]);
  TeamDAO.getActivePrograms.mockResolvedValue([]);
  ApplicationDAO.getDecidedApplicationsByProgramPopulated.mockResolvedValue([]);
  ProgramDAO.getProgramByIdLean.mockResolvedValue(null);
  DocumentthreadDAO.findThreads.mockResolvedValue([]);
});

describe('GET /api/student-applications/conflicts', () => {
  it('returns the conflicts the DAO computes', async () => {
    const conflict = {
      programId: conflictProgram._id,
      applicationCount: 2,
      students: [studentA._id, studentB._id],
      program: { _id: conflictProgram._id }
    };
    ApplicationDAO.getApplicationConflicts.mockResolvedValue([conflict]);

    const resp = await api
      .get('/api/student-applications/conflicts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(ApplicationDAO.getApplicationConflicts).toHaveBeenCalledTimes(1);
    expect(Array.isArray(resp.body.data)).toBe(true);
    const got = resp.body.data.find(
      (c: { programId?: { toString(): string } }) =>
        c.programId?.toString() === conflictProgram._id.toString()
    );
    expect(got).toBeTruthy();
    expect(got.applicationCount).toBe(2);
    expect(got.students.length).toBe(2);
  });

  it('returns an empty array when the DAO reports no conflict', async () => {
    ApplicationDAO.getApplicationConflicts.mockResolvedValue([]);

    const resp = await api
      .get('/api/student-applications/conflicts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual([]);
  });
});

describe('GET /api/student-applications/deltas', () => {
  it('returns a 200 success envelope with a data array when there are no active programs', async () => {
    TeamDAO.getActivePrograms.mockResolvedValue([]);

    const resp = await api
      .get('/api/student-applications/deltas')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toEqual([]);
    expect(TeamDAO.getActivePrograms).toHaveBeenCalledTimes(1);
  });

  it('drops programs whose students have no document deltas', async () => {
    // One active program; its decided students have threads that already match
    // the program requirements, so every per-student delta is empty -> the
    // program is filtered out and the response data is [].
    TeamDAO.getActivePrograms.mockResolvedValue([{ _id: conflictProgram._id }]);
    ApplicationDAO.getDecidedApplicationsByProgramPopulated.mockResolvedValue([
      {
        studentId: { _id: studentA._id, agents: [] },
        application_year: '2024',
        closed: '-',
        admission: '-'
      }
    ]);
    ProgramDAO.getProgramByIdLean.mockResolvedValue({
      _id: conflictProgram._id,
      school: conflictProgram.school,
      program_name: conflictProgram.program_name,
      degree: conflictProgram.degree,
      semester: conflictProgram.semester
    });
    // No required documents on the program + no threads -> empty delta.
    DocumentthreadDAO.findThreads.mockResolvedValue([]);

    const resp = await api
      .get('/api/student-applications/deltas')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toEqual([]);
    expect(
      ApplicationDAO.getDecidedApplicationsByProgramPopulated
    ).toHaveBeenCalledWith(conflictProgram._id);
  });
});
