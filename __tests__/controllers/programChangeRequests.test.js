const request = require('supertest');
const { ObjectId } = require('mongoose').Types;

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { programSchema } = require('../../models/Program');
const {
  programChangeRequestSchema
} = require('../../models/ProgramChangeRequest');
const { UserSchema } = require('../../models/User');
const { generateProgram } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

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
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

let dbUri;
const program1 = generateProgram();

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const ProgramModel = db.model('Program', programSchema);
  const ProgramChangeRequestModel = db.model(
    'ProgramChangeRequest',
    programChangeRequestSchema
  );

  await UserModel.deleteMany();
  await ProgramModel.deleteMany();
  await ProgramChangeRequestModel.deleteMany();

  await UserModel.insertMany(users);
  await ProgramModel.create(program1);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('POST /api/programs/:programId/change-requests', () => {
  it('submits a change request for an existing program', async () => {
    const resp = await requestWithSupertest
      .post(`/api/programs/${program1._id}/change-requests`)
      .set('tenantId', TENANT_ID)
      .send({ program_name: 'Updated Program Name' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  it('returns 404 when the program does not exist', async () => {
    const resp = await requestWithSupertest
      .post(`/api/programs/${new ObjectId().toHexString()}/change-requests`)
      .set('tenantId', TENANT_ID)
      .send({ program_name: 'Whatever' });

    expect(resp.status).toBe(404);
  });
});

describe('GET /api/programs/:programId/change-requests', () => {
  it('returns the open change requests for the program', async () => {
    await requestWithSupertest
      .post(`/api/programs/${program1._id}/change-requests`)
      .set('tenantId', TENANT_ID)
      .send({ program_name: 'Updated Program Name' });

    const resp = await requestWithSupertest
      .get(`/api/programs/${program1._id}/change-requests`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(1);
  });
});

describe('POST /api/programs/review-changes/:requestId', () => {
  it('marks an open change request as reviewed', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramChangeRequestModel = db.model(
      'ProgramChangeRequest',
      programChangeRequestSchema
    );
    const created = await ProgramChangeRequestModel.create({
      programId: program1._id,
      requestedBy: admin._id,
      programChanges: { program_name: 'Updated Program Name' }
    });

    const resp = await requestWithSupertest
      .post(`/api/programs/review-changes/${created._id}`)
      .set('tenantId', TENANT_ID)
      .send();

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.reviewedBy).toBeDefined();
  });

  it('returns 400 when the change request was already reviewed', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramChangeRequestModel = db.model(
      'ProgramChangeRequest',
      programChangeRequestSchema
    );
    const created = await ProgramChangeRequestModel.create({
      programId: program1._id,
      requestedBy: admin._id,
      reviewedBy: admin._id,
      reviewedAt: new Date(),
      programChanges: { program_name: 'Updated Program Name' }
    });

    const resp = await requestWithSupertest
      .post(`/api/programs/review-changes/${created._id}`)
      .set('tenantId', TENANT_ID)
      .send();

    expect(resp.status).toBe(400);
  });
});
