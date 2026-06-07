// DAO-level integration test for UserlogDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Userlog, User } = require('../../models');
const UserlogDAO = require('../../dao/userlog.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, student } = require('../mock/user');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Userlog.deleteMany({});
  await User.deleteMany({});
  await User.insertMany(users);
});

describe('UserlogDAO (in-memory)', () => {
  it('getUserlogs returns all logs newest-first with the user populated', async () => {
    await Userlog.create({
      user_id: admin._id.toString(),
      operation: 'login',
      apiPath: '/api/auth/login',
      apiCallCount: 1,
      date: new Date()
    });
    await Userlog.create({
      user_id: student._id.toString(),
      operation: 'logout',
      apiPath: '/api/auth/logout',
      apiCallCount: 1,
      date: new Date()
    });

    const logs = await UserlogDAO.getUserlogs();

    expect(logs).toHaveLength(2);
    expect(logs[0].user_id.firstname).toBeDefined();
  });

  it('getUserlogsByUserId filters to one user', async () => {
    await Userlog.create({
      user_id: admin._id.toString(),
      operation: 'login',
      apiPath: '/api/auth/login',
      apiCallCount: 1,
      date: new Date()
    });
    await Userlog.create({
      user_id: student._id.toString(),
      operation: 'logout',
      apiPath: '/api/auth/logout',
      apiCallCount: 1,
      date: new Date()
    });

    const logs = await UserlogDAO.getUserlogsByUserId(admin._id.toString());

    expect(logs).toHaveLength(1);
    expect(logs[0].user_id._id.toString()).toBe(admin._id.toString());
  });
});
