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

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

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

const request = require('supertest');

const { app } = require('../../app');
const { protect } = require('../../middlewares/auth');
const { getS3Object } = require('../../aws/s3');
const ApplicationDAO = require('../../dao/application.dao');
const StudentDAO = require('../../dao/student.dao');
const { TENANT_ID } = require('../fixtures/constants');
const { admin, student } = require('../mock/user');

const requestWithSupertest = request(app);
const studentId = student._id.toString();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admissions', () => {
  it('returns the admitted applications and the program-counts result', async () => {
    const applications = [
      {
        _id: 'app-1',
        admission: 'O',
        studentId: { _id: studentId, firstname: student.firstname }
      }
    ];
    const programCounts = [{ programId: 'p1', count: 3 }];

    ApplicationDAO.getApplicationsWithStudentDetails.mockResolvedValue(
      applications
    );
    ApplicationDAO.getProgramApplicationCounts.mockResolvedValue(programCounts);

    const resp = await requestWithSupertest
      .get('/api/admissions?admission=O')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(Array.isArray(resp.body.result)).toBe(true);
    expect(resp.body.data).toHaveLength(1);
    expect(resp.body.data[0].studentId._id.toString()).toBe(studentId);
    // The admission=O query param flows into the filter the builder produces.
    expect(
      ApplicationDAO.getApplicationsWithStudentDetails
    ).toHaveBeenCalledWith(expect.objectContaining({ admission: 'O' }));
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
    getS3Object.mockResolvedValue(Buffer.from('mock pdf content'));

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
