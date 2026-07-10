// Integration test for the portal-informations routes — HTTP boundary down to
// the service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real
//   controllers/portal_informations -> real StudentService/ApplicationService ->
//   MOCKED StudentDAO / ApplicationDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query/nested-update construction is covered by the DAO unit tests.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
const { ObjectId } = require('mongoose').Types;

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.authMock({ prohibit: jest.fn(() => mw.passthrough) });
});
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

// The data boundary: mock the DAOs the student/application services delegate to.
jest.mock('../../dao/student.dao');
jest.mock('../../dao/application.dao');

import StudentDAOModule from '../../dao/student.dao';
import ApplicationDAOModule from '../../dao/application.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, student } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

const applicationId = new ObjectId().toHexString();

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('GET /api/portal-informations/:studentId', () => {
  it('returns the student together with their applications from the DAOs', async () => {
    StudentDAO.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: student.firstname,
      lastname: student.lastname,
      agents: [],
      editors: []
    });
    ApplicationDAO.getApplicationsWithCredentialsByStudentId.mockResolvedValue([
      {
        _id: applicationId,
        studentId: student._id,
        portal_credentials: {
          application_portal_a: { account: 'acct_a', password: 'pw_a' }
        }
      }
    ]);

    const resp = await requestWithSupertest
      .get(`/api/portal-informations/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(StudentDAO.getStudentById).toHaveBeenCalledWith(
      student._id.toString()
    );
    expect(
      ApplicationDAO.getApplicationsWithCredentialsByStudentId
    ).toHaveBeenCalledWith(student._id.toString());
    expect(resp.body.data.student._id.toString()).toBe(student._id.toString());
    expect(Array.isArray(resp.body.data.applications)).toBe(true);
    expect(resp.body.data.applications[0]._id.toString()).toBe(applicationId);
  });
});

describe('POST /api/portal-informations/:studentId/:applicationId', () => {
  it('updates the application via the DAO with the nested portal credentials', async () => {
    ApplicationDAO.updateApplication.mockResolvedValue({
      _id: applicationId,
      studentId: student._id
    });

    const post = await requestWithSupertest
      .post(`/api/portal-informations/${student._id}/${applicationId}`)
      .set('tenantId', TENANT_ID)
      .send({
        account_portal_a: 'test_account_a',
        password_portal_a: 'test_password_a',
        account_portal_b: 'test_account_b',
        password_portal_b: 'test_password_b'
      });

    expect(post.status).toBe(200);
    expect(post.body.success).toBe(true);
    expect(ApplicationDAO.updateApplication).toHaveBeenCalledWith(
      { _id: applicationId },
      {
        portal_credentials: {
          application_portal_a: {
            account: 'test_account_a',
            password: 'test_password_a'
          },
          application_portal_b: {
            account: 'test_account_b',
            password: 'test_password_b'
          }
        }
      }
    );
    expect(post.body.data._id.toString()).toBe(applicationId);
  });

  it('returns 400 when the application does not exist (DAO returns null)', async () => {
    ApplicationDAO.updateApplication.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .post(
        `/api/portal-informations/${
          student._id
        }/${new ObjectId().toHexString()}`
      )
      .set('tenantId', TENANT_ID)
      .send({ account_portal_a: 'x', password_portal_a: 'y' });

    expect(resp.status).toBe(400);
  });
});
