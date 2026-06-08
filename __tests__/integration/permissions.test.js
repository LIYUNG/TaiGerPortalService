// Full-stack integration layer for the permissions routes:
//   supertest -> real router -> real controllers/permissions -> real
//   PermissionService -> real PermissionDAO -> in-memory MongoDB.
//
// Only auth/tenant/permission middleware is stubbed; the outbound notification
// email is also stubbed (no SMTP in tests). Everything below the route is real,
// so a seam bug (schema/query/upsert) surfaces here. Kept thin — exhaustive
// per-handler behaviour lives in ../controllers/permissions.test.js (mocked).

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
jest.mock('../../services/email', () => ({
  updatePermissionNotificationEmail: jest.fn()
}));

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { permissionSchema } = require('../../models/Permission');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agent } = require('../mock/user');
const { updatePermissionNotificationEmail } = require('../../services/email');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);
let dbUri;

const testPermission = {
  user_id: agent._id,
  canAssignAgents: false,
  canAssignEditors: false,
  canModifyProgramList: false,
  canContactStudents: false
};

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
  const PermissionModel = db.model('Permission', permissionSchema);
  await UserModel.deleteMany();
  await PermissionModel.deleteMany();
  await UserModel.insertMany(users);
  await PermissionModel.insertMany([testPermission]);
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/permissions/:user_id (full stack)', () => {
  it('returns the persisted permissions list (the seeded agent permission)', async () => {
    const resp = await requestWithSupertest
      .get(`/api/permissions/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    // getPermissions({}) returns ALL permission docs (lean, user_id NOT
    // populated); we seeded exactly one, for the agent.
    expect(resp.body.data.length).toBe(1);
    expect(resp.body.data[0].user_id.toString()).toBe(agent._id.toString());
  });
});

describe('POST /api/permissions/:user_id (full stack)', () => {
  it('upserts the permission and the change is visible on a subsequent read', async () => {
    const post = await requestWithSupertest
      .post(`/api/permissions/${agent._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        user_id: agent._id,
        canAssignAgents: true,
        canAssignEditors: false,
        canModifyProgramList: true
      });

    expect(post.status).toBe(200);
    expect(post.body.success).toBe(true);
    // Upsert returns the doc with user_id populated (firstname/lastname/email).
    expect(post.body.data.canAssignAgents).toBe(true);
    expect(post.body.data.canModifyProgramList).toBe(true);
    // Notification email is fired after the response is sent.
    expect(updatePermissionNotificationEmail).toHaveBeenCalled();

    const get = await requestWithSupertest
      .get(`/api/permissions/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(200);
    const persisted = get.body.data.find(
      (p) => p.user_id.toString() === agent._id.toString()
    );
    expect(persisted.canAssignAgents).toBe(true);
    expect(persisted.canModifyProgramList).toBe(true);
  });
});
