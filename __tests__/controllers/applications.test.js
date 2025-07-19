const fs = require('fs');
const request = require('supertest');

const { UPLOAD_PATH } = require('../../config');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const {
  InnerTaigerMultitenantFilter
} = require('../../middlewares/InnerTaigerMultitenantFilter');
const {
  permission_canAccessStudentDatabase_filter
} = require('../../middlewares/permission-filter');
const { programSchema } = require('../../models/Program');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { documentThreadsSchema } = require('../../models/Documentthread');
const { users, agent, student, student2 } = require('../mock/user');
const { program1, programs } = require('../mock/programs');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

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

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough),
    permission_canAssignAgent_filter: jest.fn().mockImplementation(passthrough),
    permission_canAssignEditor_filter: jest.fn().mockImplementation(passthrough)
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
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();

  await UserModel.insertMany(users);
  await ProgramModel.insertMany(programs);
});

afterEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();

  fs.rmSync(UPLOAD_PATH, { recursive: true, force: true });
});

// Agent should create applications (programs) to student
describe('POST /api/applications/student/:studentId', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });

  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  it('should create an application for student', async () => {
    const { _id: studentId } = student;
    const programs_arr = [];
    programs.forEach((pro) => {
      programs_arr.push(pro._id.toString());
    });
    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: programs_arr });

    const {
      status,
      body: { success }
    } = resp;

    expect(status).toBe(201);
    expect(success).toBe(true);
  });
});

describe('DELETE /api/applications/application/:applicationId', () => {
  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => {
      next();
    }
  );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
  it('should delete an application from student', async () => {
    const { _id: studentId } = student2;

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id] });

    expect(resp.status).toBe(201);
    // !!data = []
    const applications = resp.body.data;
    const applicationId = applications[0]._id;
    const resp2 = await requestWithSupertest
      .delete(`/api/applications/application/${applicationId}`)
      .set('tenantId', TENANT_ID);

    expect(resp2.status).toBe(200);
    const resp2_std = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);
    //   Why got 4?
    expect(resp2_std.body.data.applications).toHaveLength(0);
  });

  it('deleting an application should fail if one of the threads is none-empty', async () => {
    const { _id: studentId } = student2;

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id?.toString()] });

    expect(resp.status).toBe(201);

    const resp_std = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp_std.status).toBe(200);
    const newStudentData = resp_std.body.data;

    const newApplication = newStudentData.applications.find(
      (appl) => appl.programId._id?.toString() === program1._id?.toString()
    );
    const thread = newApplication.doc_modification_thread.find(
      (thr) => thr.doc_thread_id.file_type === 'ML'
    );
    expect(thread.doc_thread_id.file_type).toBe('ML');
    const messagesThreadId = thread.doc_thread_id._id?.toString();

    const resp2 = await requestWithSupertest
      .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
      .set('tenantId', TENANT_ID)
      .field('message', '{}');
    expect(resp2.status).toBe(200);
    const application_id = newApplication._id;
    const resp3 = await requestWithSupertest
      .delete(`/api/applications/application/${application_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp3.status).toBe(409);
    const resp3_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);
    // why TODO:Got 5
    expect(resp3_std.body.data.applications).toHaveLength(1);
  });
});
