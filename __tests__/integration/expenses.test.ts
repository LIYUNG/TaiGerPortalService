// Integration test for the expenses routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/expenses ->
//   real StudentService / UserService -> MOCKED StudentDAO / UserDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. Fully deterministic —
// no engine flake.

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
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/multitenant-filter', () =>
  require('../helpers/middlewareMocks').multitenantFilterMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);

// The data boundary: mock the DAOs the student/user services delegate to.
jest.mock('../../dao/student.dao');
jest.mock('../../dao/user.dao');

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import StudentDAOModule from '../../dao/student.dao';
import UserDAOModule from '../../dao/user.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agent, student } from '../mock/user';

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
const UserDAO = UserDAOModule as unknown as MockedDAO;

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

describe('GET /api/expenses/', () => {
  it('returns a success envelope with the taiger-users-with-expenses array from the DAO', async () => {
    StudentDAO.getTaigerUsersWithExpenses.mockResolvedValue([
      { _id: agent._id }
    ]);

    const resp = await requestWithSupertest
      .get('/api/expenses/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(StudentDAO.getTaigerUsersWithExpenses).toHaveBeenCalled();
  });
});

describe('GET /api/expenses/users/:taiger_user_id', () => {
  it('returns the resolved staff user together with their students', async () => {
    UserDAO.getUserById.mockResolvedValue(agent);
    StudentDAO.getStudentsWithExpenses.mockResolvedValue([]);
    StudentDAO.getStudentsForExpenses.mockResolvedValue([{ _id: student._id }]);

    const resp = await requestWithSupertest
      .get(`/api/expenses/users/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // The agent is a valid TaiGer staff user, so the controller resolves them
    // and returns a { students, the_user } payload.
    expect(resp.body.data.the_user._id.toString()).toBe(agent._id.toString());
    expect(Array.isArray(resp.body.data.students)).toBe(true);
    expect(UserDAO.getUserById).toHaveBeenCalledWith(agent._id.toString());
    expect(StudentDAO.getStudentsForExpenses).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id.toString() })
    );
  });

  it('returns 401 when the target user is not a TaiGer staff member', async () => {
    UserDAO.getUserById.mockResolvedValue(student);

    const resp = await requestWithSupertest
      .get(`/api/expenses/users/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(401);
    expect(StudentDAO.getStudentsForExpenses).not.toHaveBeenCalled();
  });
});
