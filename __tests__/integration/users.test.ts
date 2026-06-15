// Integration test for the users routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/users ->
//   real UserService -> MOCKED UserDAO.
//
// These assert the controller/service pass the right arguments to the DAO (incl.
// the filter the UserQueryBuilder constructs and the pagination args) and shape
// the HTTP response from the DAO's (mocked) return. Fully deterministic — no
// engine flake.

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
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

// updateUser sends an email after responding; stub it so no mail transport is
// touched. The user update itself stays fully real.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  updateNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined)
}));

// The data boundary: mock the DAO the user service delegates to.
jest.mock('../../dao/user.dao');

import request from 'supertest';
import { Role } from '@taiger-common/core';
import UserDAO from '../../dao/user.dao';
import { app } from '../../app';
import { generateUser } from '../fixtures/faker';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';

const requestWithSupertest = request(app);

const admins = [...Array(2)].map(() => generateUser(Role.Admin));
const agents = [...Array(3)].map(() => generateUser(Role.Agent));
const editors = [...Array(3)].map(() => generateUser(Role.Editor));
const students = [...Array(5)].map(() => generateUser(Role.Student));
const guests = [...Array(5)].map(() => generateUser(Role.Guest));
const users = [...admins, ...agents, ...editors, ...students, ...guests];

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = admins[0];
    next();
  });
});

describe('GET /api/users', () => {
  it('returns every user from the DAO when unpaginated', async () => {
    UserDAO.getUsers.mockResolvedValue(users);

    const resp = await requestWithSupertest
      .get('/api/users')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(users.length);
    // No role filter -> the builder yields a filter without a role constraint.
    expect(UserDAO.getUsers).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUsers.mock.calls[0][0].role).toBeUndefined();
  });

  it('paginates the user list via the DAO', async () => {
    // The controller shapes the pagination args via parseUsersPaginationQuery,
    // then passes them to getUsersPaginated.
    UserDAO.parseUsersPaginationQuery.mockReturnValue({
      page: 1,
      limit: 5,
      skip: 0,
      search: undefined,
      sort: { createdAt: -1 }
    });
    UserDAO.getUsersPaginated.mockResolvedValue({
      users: users.slice(0, 5),
      total: users.length,
      page: 1,
      limit: 5
    });

    const resp = await requestWithSupertest
      .get('/api/users?page=1&limit=5')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.length).toBe(5);
    expect(resp.body.total).toBe(users.length);
    expect(resp.body.page).toBe(1);
    expect(resp.body.limit).toBe(5);
    expect(UserDAO.parseUsersPaginationQuery).toHaveBeenCalledWith(
      expect.objectContaining({ page: '1', limit: '5' })
    );
    expect(UserDAO.getUsersPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 5 })
    );
  });
});

describe('GET /api/users?role=Agent', () => {
  it('passes the role filter to the DAO and returns the agents', async () => {
    UserDAO.getUsers.mockResolvedValue(agents);

    const resp = await requestWithSupertest
      .get('/api/users?role=Agent')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const agentIds = agents.map(({ _id }) => _id.toString()).sort();
    const receivedIds = resp.body.data.map(({ _id }) => _id.toString()).sort();
    expect(receivedIds).toEqual(agentIds);
    // The UserQueryBuilder encodes the role into the DAO filter.
    expect(UserDAO.getUsers).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.Agent })
    );
  });
});

describe('POST /api/users/:user_id', () => {
  it('updates a user role via the DAO and returns the updated record', async () => {
    const target = students[0];
    const { email } = generateUser(Role.Editor);
    const updated = { _id: target._id, role: Role.Editor, email };

    UserDAO.updateUserWithOptions.mockResolvedValue(updated);
    // updateUser re-reads the user to build the notification email.
    UserDAO.getUserById.mockResolvedValue(updated);

    const resp = await requestWithSupertest
      .post(`/api/users/${target._id}`)
      .set('tenantId', TENANT_ID)
      .send({ email, role: Role.Editor });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toMatchObject({ role: Role.Editor, email });
    // Only email + role are picked from the body and forwarded to the DAO.
    expect(UserDAO.updateUserWithOptions).toHaveBeenCalledWith(
      target._id.toString(),
      { email, role: Role.Editor },
      expect.objectContaining({ new: true })
    );
  });

  it('refuses to promote a user to Admin (409) before any DAO write', async () => {
    const target = guests[0];
    const { email } = generateUser(Role.Admin);

    const resp = await requestWithSupertest
      .post(`/api/users/${target._id}`)
      .set('tenantId', TENANT_ID)
      .send({ email, role: Role.Admin });

    expect(resp.status).toBe(409);
    expect(resp.body.success).toBe(false);
    expect(UserDAO.updateUserWithOptions).not.toHaveBeenCalled();
  });
});
