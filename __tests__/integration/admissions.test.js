// Full-stack integration test for the admissions routes:
//   supertest -> real router -> real controllers/admissions -> real
//   ApplicationService / StudentService -> real DAOs -> in-memory MongoDB.
//
// Nothing below the route is mocked except auth/tenant/permission middleware and
// the S3 client (getAdmissionLetter streams a file from S3 — there is no real
// bucket in tests). This is the layer that catches the seam bugs the mocked
// controller unit test (../controllers/admissions.test.js) cannot see. Kept
// thin: happy paths only, asserting real persisted data where deterministic.

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

// ── Imports ───────────────────────────────────────────────────────────────────

const request = require('supertest');
const { mockClient } = require('aws-sdk-client-mock');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { ObjectId } = require('mongoose').Types;

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { applicationSchema } = require('../../models/Application');
const { protect } = require('../../middlewares/auth');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { disconnectFromDatabase } = require('../../database');
const { s3Client } = require('../../aws');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, student } = require('../mock/user');

const requestWithSupertest = request(app);
const s3ClientMock = mockClient(s3Client);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let dbUri;

beforeAll(async () => {
  dbUri = await connect();

  // Mock S3 GetObject: return a minimal binary response so getAdmissionLetter
  // can call transformToByteArray() and res.end() the buffer.
  s3ClientMock.on(GetObjectCommand).callsFake(async () => ({
    Body: {
      transformToByteArray: async () => Buffer.from('mock pdf content'),
      pipe: jest.fn()
    },
    ContentType: 'application/pdf'
  }));
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
  s3ClientMock.restore();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Seed Application documents for a given student into the in-memory DB.
 * Returns the seeded application objects.
 */
async function seedApplications(studentId) {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const ApplicationModel = db.model('Application', applicationSchema);
  await ApplicationModel.deleteMany();

  const apps = await ApplicationModel.insertMany([
    {
      studentId,
      decided: 'O',
      closed: 'O',
      admission: 'O',
      programId: new ObjectId()
    },
    {
      studentId,
      decided: 'O',
      closed: 'O',
      admission: 'X',
      programId: new ObjectId()
    }
  ]);
  return apps;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admissions (full stack)', () => {
  it('returns the admitted applications and the program-counts result', async () => {
    const { _id: studentId } = student;
    await seedApplications(studentId);

    // Filter on admission='O' so the seeded admission:'X' application is
    // excluded — without the query param the builder produces an empty filter
    // and BOTH seeded applications come back.
    const resp = await requestWithSupertest
      .get('/api/admissions?admission=O')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(Array.isArray(resp.body.result)).toBe(true);
    // Only the admission:'O' application is admitted -> exactly one row, owned
    // by the seeded student.
    expect(resp.body.data).toHaveLength(1);
    expect(resp.body.data[0].studentId._id.toString()).toBe(
      studentId.toString()
    );
  });
});

describe('GET /api/admissions/overview (full stack)', () => {
  it('returns the admission status counts object', async () => {
    const { _id: studentId } = student;
    await seedApplications(studentId);

    const resp = await requestWithSupertest
      .get('/api/admissions/overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
    expect(typeof resp.body.data).toBe('object');
  });
});

describe('GET /api/admissions/:applications_year (full stack)', () => {
  it('returns an empty array when no students match the requested year', async () => {
    // getAdmissionsYear queries the Student model by student_id = applications_year.
    // No Student docs with student_id = '2024' are seeded, so the result is empty.
    const resp = await requestWithSupertest
      .get('/api/admissions/2024')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(0);
  });
});

describe('GET /api/admissions/:studentId/admission/:fileName (full stack)', () => {
  it('streams the admission letter from S3 as an attachment', async () => {
    const { _id: studentId } = student;
    const fileName = 'offer_letter.pdf';

    const resp = await requestWithSupertest
      .get(`/api/admissions/${studentId}/admission/${fileName}`)
      .set('tenantId', TENANT_ID)
      .buffer(); // collect the streamed binary body

    expect(resp.status).toBe(200);
    // The controller sets Content-Disposition to attachment
    expect(resp.headers['content-disposition']).toMatch(/attachment/);
  });
});
