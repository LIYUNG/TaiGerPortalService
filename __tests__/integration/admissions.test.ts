// Integration test for the admissions routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/admissions
//   -> real ApplicationService / StudentService -> MOCKED ApplicationDAO /
//   StudentDAO. The S3 access in getAdmissionLetter is mocked at aws/s3.
//
// These assert the controller/service pass the right filter/args to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual aggregation
// construction is covered by the DAO unit tests. Fully deterministic — no
// database engine, no seeding.

// ── Mock declarations (must be at top, before any require()) ─────────────────

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
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/multitenant-filter', () =>
  require('../helpers/middlewareMocks').multitenantFilterMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);

// getAdmissionLetter streams a file from S3 — mock the S3 accessor so no AWS
// client is exercised.
jest.mock('../../aws/s3', () => ({
  ...jest.requireActual('../../aws/s3'),
  getS3Object: jest.fn()
}));

// The data boundary: mock the DAOs the application/student services delegate to.
jest.mock('../../dao/application.dao');
jest.mock('../../dao/student.dao');

// ── Imports ───────────────────────────────────────────────────────────────────

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { getS3Object } from '../../aws/s3';
import ApplicationDAOModule from '../../dao/application.dao';
import StudentDAOModule from '../../dao/student.dao';
import { TENANT_ID } from '../fixtures/constants';
import { admin, student } from '../mock/user';

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
const StudentDAO = StudentDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);
const studentId = student._id.toString();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admissions/program-counts', () => {
  // Returns only the per-program application counts; the paginated applications
  // list is served by GET /api/applications/applications/paginated.
  it('returns the program-counts result', async () => {
    const programCounts = [{ programId: 'p1', count: 3 }];

    ApplicationDAO.getProgramApplicationCounts.mockResolvedValue(programCounts);

    const resp = await requestWithSupertest
      .get('/api/admissions/program-counts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.result)).toBe(true);
    expect(resp.body.result).toEqual(programCounts);
    expect(ApplicationDAO.getProgramApplicationCounts).toHaveBeenCalled();
  });
});

describe('GET /api/admissions/overview', () => {
  it('returns the admission status counts object', async () => {
    const counts = {
      admission: 5,
      rejection: 2,
      pending: 1,
      notYetSubmitted: 0
    };
    ApplicationDAO.getAdmissionsStatusCounts.mockResolvedValue(counts);

    const resp = await requestWithSupertest
      .get('/api/admissions/overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('object');
    expect(resp.body.data).toEqual(counts);
    expect(ApplicationDAO.getAdmissionsStatusCounts).toHaveBeenCalled();
  });
});

describe('GET /api/admissions/:applications_year', () => {
  it('queries students by student_id = applications_year and returns them', async () => {
    StudentDAO.findStudents.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get('/api/admissions/2024')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(0);
    expect(StudentDAO.findStudents).toHaveBeenCalledWith({
      student_id: '2024'
    });
  });
});

describe('GET /api/admissions/:studentId/admission/:fileName', () => {
  it('streams the admission letter from S3 as an attachment', async () => {
    const fileName = 'offer_letter.pdf';
    asMock(getS3Object).mockResolvedValue(Buffer.from('mock pdf content'));

    const resp = await requestWithSupertest
      .get(`/api/admissions/${studentId}/admission/${fileName}`)
      .set('tenantId', TENANT_ID)
      .buffer(); // collect the streamed binary body

    expect(resp.status).toBe(200);
    expect(resp.headers['content-disposition']).toMatch(/attachment/);
    // The controller builds the S3 key from the params.
    expect(getS3Object).toHaveBeenCalledWith(
      expect.anything(),
      `${studentId}/admission/${fileName}`
    );
  });
});
