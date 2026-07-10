// Integration test for the uni-assist route — HTTP boundary down to the
// services, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/uniassist
//   -> real StudentService + ApplicationService -> MOCKED StudentDAO /
//   ApplicationDAO.
//
// These assert the controller/service pass the right arguments to the DAOs and
// shape the HTTP response from the DAOs' (mocked) return. Fully deterministic —
// no engine flake.

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles: string[]) => passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

// The data boundary: mock the DAOs the student/application services delegate to.
jest.mock('../../dao/student.dao');
jest.mock('../../dao/application.dao');

const { ObjectId } = require('mongoose').Types;
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import StudentDAOModule from '../../dao/student.dao';
import ApplicationDAOModule from '../../dao/application.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, student } from '../mock/user';
import { generateProgram } from '../fixtures/faker';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

const program1 = generateProgram();

const testApplication = {
  _id: new ObjectId().toHexString(),
  studentId: student._id,
  programId: program1._id,
  closed: '-',
  decided: '-'
};

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('getStudentUniAssist Controller', () => {
  it('GET /api/uniassist/:studentId returns the student from the DAO with their applications attached', async () => {
    // The controller does `student.applications = applications`, so the student
    // returned by the DAO must be a mutable plain object.
    StudentDAO.getStudentById.mockResolvedValue({ _id: student._id });
    ApplicationDAO.getApplicationsByStudentId.mockResolvedValue([
      testApplication
    ]);

    const resp = await requestWithSupertest
      .get(`/api/uniassist/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(student._id.toString());
    // Applications for that student are attached by the controller.
    expect(Array.isArray(resp.body.data.applications)).toBe(true);
    expect(resp.body.data.applications).toHaveLength(1);
    expect(resp.body.data.applications[0]._id.toString()).toBe(
      testApplication._id.toString()
    );
    // Each DAO is queried by the path's studentId.
    expect(StudentDAO.getStudentById).toHaveBeenCalledWith(
      student._id.toString()
    );
    expect(ApplicationDAO.getApplicationsByStudentId).toHaveBeenCalledWith(
      student._id.toString()
    );
  });
});
