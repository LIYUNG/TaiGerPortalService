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
    permit: jest.fn().mockImplementation((...roles) => passthrough)
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

describe('GET /api/program-requirements/', () => {
  it('getProgramRequirements', async () => {
    const resp = await requestWithSupertest
      .get('/api/program-requirements/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('GET /api/program-requirements/programs-and-keywords/', () => {
  it('getDistinctProgramsAndKeywordSets', async () => {
    const resp = await requestWithSupertest
      .get('/api/program-requirements/programs-and-keywords')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('POST /api/program-requirements/new/', () => {
  it('createProgramRequirement', async () => {
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
  });
});

describe('GET /api/program-requirements/:requirementId', () => {
  it('getProgramRequirement', async () => {
    const resp = await requestWithSupertest
      .get(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

describe('PUT /api/program-requirements/:requirementId', () => {
  it('updateInterview', async () => {
    const resp = await requestWithSupertest
      .put(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        admissionDescription: 'modified_description'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/program-requirements/:requirementId', () => {
  it('deleteInterview', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/program-requirements/${programRequirements2._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});
