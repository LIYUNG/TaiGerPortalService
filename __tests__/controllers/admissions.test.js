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

describe('GET /api/admissions', () => {
  it('should return admissions list with status 200', async () => {
    const { _id: studentId } = student;
    await seedApplications(studentId);

    const resp = await requestWithSupertest
      .get('/api/admissions')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(Array.isArray(resp.body.result)).toBe(true);
  });
});

describe('GET /api/admissions/overview', () => {
  it('should return admissions overview with status 200', async () => {
    const { _id: studentId } = student;
    await seedApplications(studentId);

    const resp = await requestWithSupertest
      .get('/api/admissions/overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
  });
});

describe('GET /api/admissions/:applications_year', () => {
  it('should return admissions for a given year with status 200', async () => {
    // getAdmissionsYear queries the Student model by student_id = applications_year.
    // No Student docs with student_id = '2024' are seeded, so the result is an empty array.
    const resp = await requestWithSupertest
      .get('/api/admissions/2024')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});

describe('GET /api/admissions/:studentId/admission/:fileName', () => {
  it('should stream the admission letter from S3 with status 200', async () => {
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
