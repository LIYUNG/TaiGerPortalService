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

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
// The helper's permissionFilterMock also stubs canAssignAgent_filter and
// canAssignEditor_filter (this file only exercises
// canAccessStudentDatabase_filter) — over-stubbing is fine, both are
// unconditional passthroughs.
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/multitenant-filter', () =>
  require('../helpers/middlewareMocks').multitenantFilterMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);
jest.mock('../../services/email', () => ({
  updatePermissionNotificationEmail: jest.fn()
}));

// The data boundary: mock the DAO the permission service delegates to.
jest.mock('../../dao/permission.dao');

import PermissionDAOModule from '../../dao/permission.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agent } from '../mock/user';
import { updatePermissionNotificationEmail } from '../../services/email';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const PermissionDAO = PermissionDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
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
