const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { programSchema } = require('../../models/Program');
const { generateProgram } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { TENANT_ID } = require('../fixtures/constants');
const { admin } = require('../mock/user');
const { programs } = require('../mock/programs');
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

  const ProgramModel = db.model('Program', programSchema);

  await ProgramModel.deleteMany();
  await ProgramModel.insertMany(programs);
});

describe('GET /api/programs', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
  it('should return all programs', async () => {
    const resp = await requestWithSupertest
      .get('/api/programs')
      .set('tenantId', TENANT_ID);
    const { success, data } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data).toEqual(expect.any(Array));
    expect(data.length).toBe(programs.length);
  });
});

describe('POST /api/programs', () => {
  it('should create a program', async () => {
    const { _id, ...fields } = generateProgram();
    const resp = await requestWithSupertest.post('/api/programs').send(fields);
    const { success, data } = resp.body;

    expect(resp.status).toBe(201);
    expect(success).toBe(true);
  });
});

describe('PUT /api/programs/:id', () => {
  it('should update a program', async () => {
    const { _id } = programs[0];
    const { _id: _, ...fields } = generateProgram();

    const resp = await requestWithSupertest
      .put(`/api/programs/${_id}`)
      .send(fields);
    const { success } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
  });
});

describe('DELETE /api/programs/:id', () => {
  it('should delete a program', async () => {
    const { _id } = programs[0];

    const resp = await requestWithSupertest.delete(`/api/programs/${_id}`);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});
