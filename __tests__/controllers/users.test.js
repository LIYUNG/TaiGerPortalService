const request = require('supertest');
const { Role } = require('@taiger-common/core');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { User, UserSchema } = require('../../models/User');
const { generateUser } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
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
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});
const admins = [...Array(2)].map(() => generateUser(Role.Admin));
const agents = [...Array(3)].map(() => generateUser(Role.Agent));
const editors = [...Array(3)].map(() => generateUser(Role.Editor));
const students = [...Array(5)].map(() => generateUser(Role.Student));
const guests = [...Array(5)].map(() => generateUser(Role.Guest));
const users = [...admins, ...agents, ...editors, ...students, ...guests];

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.models.User || db.model('User', UserSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

describe('GET /api/users', () => {
  protect.mockImplementation(async (req, res, next) => {
    // req.user = await User.findById(agentId);
    const admin = admins[0];
    req.user = admin;
    next();
  });

  it('should return all users', async () => {
    const resp = await requestWithSupertest
      .get('/api/users')
      .set('tenantId', TENANT_ID);
    const { success, data } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data).toEqual(expect.any(Array));
    expect(data.length).toBe(users.length);
  });

  it('should return paginated users', async () => {
    const resp = await requestWithSupertest
      .get('/api/users?page=1&limit=5')
      .set('tenantId', TENANT_ID);
    const { success, data, total, page, limit } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data.length).toBe(5);
    expect(total).toBe(users.length);
    expect(page).toBe(1);
    expect(limit).toBe(5);
  });

  it('should filter paginated users by search', async () => {
    const targetUser = agents[0];
    const resp = await requestWithSupertest
      .get(
        `/api/users?page=1&limit=20&search=${encodeURIComponent(
          targetUser.firstname
        )}`
      )
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.total).toBeGreaterThanOrEqual(1);
    expect(
      resp.body.data.some(
        (user) => user._id.toString() === targetUser._id.toString()
      )
    ).toBe(true);
  });
});

// TODO: move below to their own files?
describe('GET /api/users?role=Agent', () => {
  it('should return all agents', async () => {
    const resp = await requestWithSupertest
      .get('/api/users?role=Agent')
      .set('tenantId', TENANT_ID);
    const { success, data } = resp.body;

    const agentIds = agents.map(({ _id }) => _id).sort();
    const receivedIds = data.map(({ _id }) => _id).sort();

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(receivedIds).toEqual(agentIds);
  });
});

describe('GET /api/users?role=Editor', () => {
  it('should return all editor users', async () => {
    const resp = await requestWithSupertest
      .get('/api/users?role=Editor')
      .set('tenantId', TENANT_ID);
    const { success, data } = resp.body;

    const editorIds = editors.map(({ _id }) => _id).sort();
    const receivedIds = data.map(({ _id }) => _id).sort();

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(receivedIds).toEqual(editorIds);
  });
});

describe('POST /api/users/:id', () => {
  it('should update user role', async () => {
    const { _id } = users[3];
    const { email, role } = generateUser(Role.Editor);

    const resp = await requestWithSupertest
      .post(`/api/users/${_id}`)
      .set('tenantId', TENANT_ID)
      .send({ email, role });
    const { success, data } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data).toMatchObject({
      role: Role.Editor,
      email
    });

    const updatedUser = await User.findById(_id);
    expect(updatedUser).toMatchObject({
      role: Role.Editor,
      email
    });
  });

  it('should not update Admin role', async () => {
    const { _id } = users[5];
    const { email, role } = generateUser(Role.Admin);

    const resp = await requestWithSupertest
      .post(`/api/users/${_id}`)
      .set('tenantId', TENANT_ID)
      .send({ email, role });
    const { success } = resp.body;

    expect(resp.status).toBe(409);
    expect(success).toBe(false);
  });
});

describe('DELETE /api/users/:id', () => {
  it('should delete a user', async () => {
    const { _id } = users[0];

    const resp = await requestWithSupertest
      .delete(`/api/users/${_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);

    const deletedUser = await User.findById(_id);
    expect(deletedUser).toBe(null);
  });
});
