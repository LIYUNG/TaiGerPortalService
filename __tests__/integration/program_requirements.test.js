// Full-stack integration test for the program-requirements routes:
//   supertest -> real router -> real controllers/program_requirements ->
//   real ProgramRequirementService -> real DAOs -> in-memory MongoDB.
//
// Only auth/tenant/permission middleware is stubbed; everything below the route
// is real, so a seam bug (schema mismatch, bad query) surfaces here. Ported from
// the original __tests__/controllers/program_requirements.test.js with the weak
// status-only assertions strengthened against real persisted data. The
// exhaustive per-handler behaviour lives in
// ../controllers/program_requirements.test.js (mocked).

const request = require('supertest');
const { programRequirementSchema } = require('@taiger-common/model');

const { connect, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin } = require('../mock/user');
const { app } = require('../../app');
const { program4 } = require('../mock/programs');
const { disconnectFromDatabase } = require('../../database');
const {
  programRequirements1,
  programRequirements2,
  programRequirementss,
  programRequirementsNew
} = require('../mock/programRequirements');

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

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const ProgramRequirementModel = db.model(
    'ProgramRequirement',
    programRequirementSchema
  );

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await ProgramRequirementModel.deleteMany();
  await ProgramRequirementModel.insertMany(programRequirementss);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/program-requirements/ (full stack)', () => {
  it('returns all seeded program requirements', async () => {
    const resp = await requestWithSupertest
      .get('/api/program-requirements/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(programRequirementss.length);
  });
});

describe('GET /api/program-requirements/programs-and-keywords/ (full stack)', () => {
  it('returns distinct programs and keyword sets', async () => {
    const resp = await requestWithSupertest
      .get('/api/program-requirements/programs-and-keywords')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveProperty('distinctPrograms');
    expect(resp.body.data).toHaveProperty('keywordsets');
  });
});

describe('POST /api/program-requirements/new/ (full stack)', () => {
  it('creates a program requirement and persists it', async () => {
    const resp = await requestWithSupertest
      .post('/api/program-requirements/new/')
      .set('tenantId', TENANT_ID)
      .send({
        ...programRequirementsNew,
        program: {
          school: program4.school,
          program_name: program4.program_name,
          degree: program4.degree
        }
      });

    expect(resp.status).toEqual(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id).toBeTruthy();

    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramRequirementModel = db.model(
      'ProgramRequirement',
      programRequirementSchema
    );
    const persisted = await ProgramRequirementModel.findById(
      resp.body.data._id
    ).lean();
    expect(persisted).toBeTruthy();
  });
});

describe('GET /api/program-requirements/:requirementId (full stack)', () => {
  it('returns the requested requirement bundled with distinct programs/keywords', async () => {
    const resp = await requestWithSupertest
      .get(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.requirement._id.toString()).toBe(
      programRequirements1._id.toString()
    );
    expect(resp.body.data).toHaveProperty('distinctPrograms');
    expect(resp.body.data).toHaveProperty('keywordsets');
  });
});

describe('PUT /api/program-requirements/:requirementId (full stack)', () => {
  it('updates the requirement and the change is persisted', async () => {
    const resp = await requestWithSupertest
      .put(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        admissionDescription: 'modified_description'
      });

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);

    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramRequirementModel = db.model(
      'ProgramRequirement',
      programRequirementSchema
    );
    const persisted = await ProgramRequirementModel.findById(
      programRequirements1._id
    ).lean();
    expect(persisted.admissionDescription).toBe('modified_description');
  });
});

describe('DELETE /api/program-requirements/:requirementId (full stack)', () => {
  it('deletes the requirement so it is gone from the collection', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/program-requirements/${programRequirements2._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);

    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramRequirementModel = db.model(
      'ProgramRequirement',
      programRequirementSchema
    );
    const persisted = await ProgramRequirementModel.findById(
      programRequirements2._id
    ).lean();
    expect(persisted).toBeNull();
  });
});
