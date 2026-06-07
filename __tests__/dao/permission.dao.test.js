// DAO-level integration test for PermissionDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Permission, User } = require('../../models');
const PermissionDAO = require('../../dao/permission.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin } = require('../mock/user');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Permission.deleteMany({});
  await User.deleteMany({});
  await User.insertMany(users);
});

describe('PermissionDAO (in-memory)', () => {
  it('getPermissions returns an empty array when none exist', async () => {
    const permissions = await PermissionDAO.getPermissions({});
    expect(permissions).toEqual([]);
  });

  it('upsertPermissionByUserId creates a permission and populates the user', async () => {
    const permission = await PermissionDAO.upsertPermissionByUserId(
      admin._id.toString(),
      { canAccessStudentDatabase: true }
    );

    expect(permission).toBeTruthy();
    expect(permission.canAccessStudentDatabase).toBe(true);
    expect(permission.user_id.firstname).toBe(admin.firstname);
    expect(await Permission.countDocuments({})).toBe(1);
  });

  it('upsertPermissionByUserId updates the existing permission in place', async () => {
    await PermissionDAO.upsertPermissionByUserId(admin._id.toString(), {
      canAccessStudentDatabase: false
    });

    const updated = await PermissionDAO.upsertPermissionByUserId(
      admin._id.toString(),
      { canAccessStudentDatabase: true }
    );

    expect(updated.canAccessStudentDatabase).toBe(true);
    expect(await Permission.countDocuments({})).toBe(1);
  });

  it('getPermissions returns the stored permissions', async () => {
    await PermissionDAO.upsertPermissionByUserId(admin._id.toString(), {
      canAccessStudentDatabase: true
    });

    const permissions = await PermissionDAO.getPermissions({});

    expect(permissions).toHaveLength(1);
    expect(permissions[0].user_id.toString()).toBe(admin._id.toString());
  });
});
