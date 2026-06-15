// Integration test for the permissions routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/permissions
//   -> real PermissionService -> MOCKED PermissionDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The outbound
// notification email is stubbed (no SMTP in tests). The actual DB
// query/upsert construction is covered by the DAO unit tests
// (__tests__/dao/permission.dao.test.js).

const request = require('supertest');

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

// The data boundary: mock the DAO the permission service delegates to.
jest.mock('../../dao/permission.dao');

const PermissionDAO = require('../../dao/permission.dao');
const { app } = require('../../app');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { admin, agent } = require('../mock/user');
const { updatePermissionNotificationEmail } = require('../../services/email');

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/permissions/:user_id', () => {
  it('returns the permissions list from the DAO (getPermissions called with {})', async () => {
    const permissions = [
      {
        user_id: agent._id,
        canAssignAgents: false,
        canAssignEditors: false,
        canModifyProgramList: false,
        canContactStudents: false
      }
    ];
    PermissionDAO.getPermissions.mockResolvedValue(permissions);

    const resp = await requestWithSupertest
      .get(`/api/permissions/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(PermissionDAO.getPermissions).toHaveBeenCalledWith({});
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(1);
    expect(resp.body.data[0].user_id.toString()).toBe(agent._id.toString());
  });
});

describe('POST /api/permissions/:user_id', () => {
  it('upserts via the DAO with the posted body and fires the notification email', async () => {
    const body = {
      user_id: agent._id,
      canAssignAgents: true,
      canAssignEditors: false,
      canModifyProgramList: true
    };
    // Upsert returns the doc with user_id populated (firstname/lastname/email);
    // the controller reads those to build the notification email.
    const saved = {
      ...body,
      user_id: {
        _id: agent._id,
        firstname: agent.firstname,
        lastname: agent.lastname,
        email: agent.email
      }
    };
    PermissionDAO.upsertPermissionByUserId.mockResolvedValue(saved);

    const post = await requestWithSupertest
      .post(`/api/permissions/${agent._id}`)
      .set('tenantId', TENANT_ID)
      .send(body);

    expect(post.status).toBe(200);
    expect(post.body.success).toBe(true);
    expect(PermissionDAO.upsertPermissionByUserId).toHaveBeenCalledWith(
      agent._id.toString(),
      expect.objectContaining({
        canAssignAgents: true,
        canModifyProgramList: true
      })
    );
    expect(post.body.data.canAssignAgents).toBe(true);
    expect(post.body.data.canModifyProgramList).toBe(true);
    // Notification email is fired after the response is sent.
    expect(updatePermissionNotificationEmail).toHaveBeenCalledWith(
      {
        firstname: agent.firstname,
        lastname: agent.lastname,
        address: agent.email
      },
      {}
    );
  });
});
