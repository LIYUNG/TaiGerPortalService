// Full-stack integration test for the programs routes:
//   supertest -> real router -> real controllers/programs -> real ProgramService
//   -> real DAOs -> in-memory MongoDB.
//
// Only auth/tenant middleware is stubbed; everything below the route is real, so
// a seam bug (schema mismatch, bad query, missing version-control write) surfaces
// here. Ported from the original __tests__/controllers/programs.test.js with the
// weak assertions strengthened against the real persisted data. The exhaustive
// per-handler behaviour lives in ../controllers/programs.test.js (mocked) and the
// service/dao suites.

const request = require('supertest');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { programSchema } = require('../../models/Program');
const { versionControlSchema } = require('../../models/VersionControl');
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

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/programs (full stack)', () => {
  it('should return paginated programs', async () => {
    const resp = await requestWithSupertest
      .get('/api/programs')
      .set('tenantId', TENANT_ID);
    const { success, data, total, page, limit } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data).toEqual(expect.any(Array));
    expect(total).toBe(programs.length);
    expect(page).toBe(1);
    expect(limit).toBe(20);
    expect(data.length).toBe(programs.length);
  });

  it('should respect page and limit query params', async () => {
    const resp = await requestWithSupertest
      .get('/api/programs?page=1&limit=2')
      .set('tenantId', TENANT_ID);
    const { data, total, page, limit } = resp.body;

    expect(resp.status).toBe(200);
    expect(data.length).toBe(2);
    expect(total).toBe(programs.length);
    expect(page).toBe(1);
    expect(limit).toBe(2);
  });

  it('should filter programs by global search', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramModel = db.model('Program', programSchema);
    const targetSchool = 'UniqueSearchableSchoolXYZ';

    await ProgramModel.create({
      ...generateProgram(),
      school: targetSchool,
      program_name: 'Searchable Program',
      isArchiv: false
    });

    const resp = await requestWithSupertest
      .get('/api/programs?search=UniqueSearchableSchool')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.total).toBeGreaterThanOrEqual(1);
    expect(
      resp.body.data.some((program) => program.school === targetSchool)
    ).toBe(true);
  });

  it('should filter programs by column filters', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramModel = db.model('Program', programSchema);
    const targetSchool = 'ColumnFilterSchoolXYZ';

    await ProgramModel.create({
      ...generateProgram(),
      school: targetSchool,
      country: 'de',
      isArchiv: false
    });

    const resp = await requestWithSupertest
      .get(
        `/api/programs?school=${encodeURIComponent(
          'ColumnFilterSchool'
        )}&country=de`
      )
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.total).toBeGreaterThanOrEqual(1);
    expect(resp.body.data.every((program) => program.country === 'de')).toBe(
      true
    );
    expect(
      resp.body.data.some((program) => program.school === targetSchool)
    ).toBe(true);
  });
});

describe('POST /api/programs (full stack)', () => {
  it('should create a program and persist it', async () => {
    const { _id, ...fields } = generateProgram();
    const resp = await requestWithSupertest.post('/api/programs').send(fields);
    const { success, data } = resp.body;

    expect(resp.status).toBe(201);
    expect(success).toBe(true);
    // the created doc carries the submitted (trimmed) school name and a real id
    expect(data._id).toBeTruthy();
    expect(data.school).toBe(fields.school.trim());

    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramModel = db.model('Program', programSchema);
    const persisted = await ProgramModel.findById(data._id).lean();
    expect(persisted).toBeTruthy();
    expect(persisted.program_name).toBe(fields.program_name.trim());
  });
});

describe('PUT /api/programs/:id (full stack)', () => {
  it('should update a program and the change is visible on read', async () => {
    const { _id } = programs[0];

    const resp = await requestWithSupertest
      .put(`/api/programs/${_id}`)
      .send({ program_name: 'Renamed Program', ml_required: 'no' });
    const { success, data } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data.program_name).toBe('Renamed Program');

    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramModel = db.model('Program', programSchema);
    const persisted = await ProgramModel.findById(_id).lean();
    expect(persisted.program_name).toBe('Renamed Program');
    expect(persisted.whoupdated).toBe(`${admin.firstname} ${admin.lastname}`);
  });

  it('records a version-control entry when a program is updated', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const VCModel = db.model('VC', versionControlSchema);
    await VCModel.deleteMany();

    const { _id } = programs[0];
    const resp = await requestWithSupertest.put(`/api/programs/${_id}`).send({
      program_name: 'VC Characterization Program',
      ml_required: 'yes'
    });
    expect(resp.status).toBe(200);

    const vcs = await VCModel.find({ collectionName: 'Program' }).lean();
    const vc = vcs.find((v) => v.docId?.toString() === _id.toString());
    expect(vc).toBeTruthy();
    expect(vc.changes.length).toBeGreaterThan(0);
  });
});

describe('DELETE /api/programs/:id (full stack)', () => {
  it('should archive a program with no applications', async () => {
    const { _id } = programs[0];

    const resp = await requestWithSupertest.delete(`/api/programs/${_id}`);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    // delete is a soft archive: the doc is flagged isArchiv, not removed
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ProgramModel = db.model('Program', programSchema);
    const persisted = await ProgramModel.findById(_id).lean();
    expect(persisted.isArchiv).toBe(true);
  });
});

describe('GET /api/programs/:programId (full stack)', () => {
  it('should return a single program by id', async () => {
    const { _id } = programs[0];

    const resp = await requestWithSupertest
      .get(`/api/programs/${_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(_id.toString());
  });
});

describe('GET /api/programs/overview (full stack)', () => {
  it('should return an aggregated programs overview', async () => {
    const resp = await requestWithSupertest
      .get('/api/programs/overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data.totalPrograms).toBe('number');
    expect(Array.isArray(resp.body.data.byCountry)).toBe(true);
  });
});

describe('GET /api/programs/same-program-students/:programId (full stack)', () => {
  it('should return students sharing the same program', async () => {
    const { _id } = programs[0];

    const resp = await requestWithSupertest
      .get(`/api/programs/same-program-students/${_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
  });
});
