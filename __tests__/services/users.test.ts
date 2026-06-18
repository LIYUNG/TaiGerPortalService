// UserService is a thin pass-through to UserDAO (controller -> service -> dao).
// This is a UNIT test: the DAO is mocked so no database (in-memory or
// otherwise) is touched. Each test asserts the service delegates to the right
// DAO method with the exact args and returns the DAO's result. The only
// service-side logic is the default `options = { new: true }` on updateUserDoc,
// which is covered explicitly.
jest.mock('../../dao/user.dao');

import UserDAO from '../../dao/user.dao';
import UserService from '../../services/users';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UserService (mocked DAO)', () => {
  it('parseUsersPaginationQuery delegates with query and returns its result', () => {
    const query = { page: '1', limit: '20' };
    const daoResult = { page: 1, limit: 20 };
    UserDAO.parseUsersPaginationQuery.mockReturnValue(daoResult);

    const result = UserService.parseUsersPaginationQuery(query);

    expect(UserDAO.parseUsersPaginationQuery).toHaveBeenCalledTimes(1);
    expect(UserDAO.parseUsersPaginationQuery).toHaveBeenCalledWith(query);
    expect(result).toBe(daoResult);
  });

  it('getUserById delegates with userId and returns its result', async () => {
    const daoResult = { _id: 'u1' };
    UserDAO.getUserById.mockResolvedValue(daoResult);

    const result = await UserService.getUserById('u1');

    expect(UserDAO.getUserById).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserById).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });

  it('findUsersByIds delegates ids + select and returns the result', async () => {
    const daoResult = [{ _id: 'a' }, { _id: 'b' }];
    UserDAO.findUsersByIds.mockResolvedValue(daoResult);

    const result = await UserService.findUsersByIds(['a', 'b'], 'email role');

    expect(UserDAO.findUsersByIds).toHaveBeenCalledWith(
      ['a', 'b'],
      'email role'
    );
    expect(result).toBe(daoResult);
  });

  it('getUsers delegates with query and returns its result', async () => {
    const query = { role: 'Agent' };
    const daoResult = [{ _id: 'u1' }];
    UserDAO.getUsers.mockResolvedValue(daoResult);

    const result = await UserService.getUsers(query);

    expect(UserDAO.getUsers).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUsers).toHaveBeenCalledWith(query);
    expect(result).toBe(daoResult);
  });

  it('getUsersPaginated delegates with args and returns its result', async () => {
    const args = { filter: {}, query: { page: 1 } };
    const daoResult = { users: [], total: 0 };
    UserDAO.getUsersPaginated.mockResolvedValue(daoResult);

    const result = await UserService.getUsersPaginated(args);

    expect(UserDAO.getUsersPaginated).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUsersPaginated).toHaveBeenCalledWith(args);
    expect(result).toBe(daoResult);
  });

  it('updateUser delegates with userId + payload and returns its result', async () => {
    const payload = { firstname: 'Jane' };
    const daoResult = { _id: 'u1', firstname: 'Jane' };
    UserDAO.updateUser.mockResolvedValue(daoResult);

    const result = await UserService.updateUser('u1', payload);

    expect(UserDAO.updateUser).toHaveBeenCalledTimes(1);
    expect(UserDAO.updateUser).toHaveBeenCalledWith('u1', payload);
    expect(result).toBe(daoResult);
  });

  it('updateOfficehours delegates with userId + role + payload', async () => {
    const payload = {
      officehours: { Monday: { active: true } },
      timezone: 'UTC'
    };
    const daoResult = { _id: 'u1', timezone: 'UTC' };
    UserDAO.updateOfficehours.mockResolvedValue(daoResult);

    const result = await UserService.updateOfficehours('u1', 'Agent', payload);

    expect(UserDAO.updateOfficehours).toHaveBeenCalledTimes(1);
    expect(UserDAO.updateOfficehours).toHaveBeenCalledWith(
      'u1',
      'Agent',
      payload
    );
    expect(result).toBe(daoResult);
  });

  it('updateUserDoc delegates with userId + payload + explicit options and returns its result', async () => {
    const payload = { firstname: 'Jane' };
    const options = { new: false };
    const daoResult = { _id: 'u1' };
    UserDAO.updateUserDoc.mockResolvedValue(daoResult);

    const result = await UserService.updateUserDoc('u1', payload, options);

    expect(UserDAO.updateUserDoc).toHaveBeenCalledTimes(1);
    expect(UserDAO.updateUserDoc).toHaveBeenCalledWith('u1', payload, options);
    expect(result).toBe(daoResult);
  });

  it('updateUserDoc defaults options to { new: true } when omitted', async () => {
    const payload = { firstname: 'Jane' };
    const daoResult = { _id: 'u1' };
    UserDAO.updateUserDoc.mockResolvedValue(daoResult);

    const result = await UserService.updateUserDoc('u1', payload);

    expect(UserDAO.updateUserDoc).toHaveBeenCalledTimes(1);
    expect(UserDAO.updateUserDoc).toHaveBeenCalledWith('u1', payload, {
      new: true
    });
    expect(result).toBe(daoResult);
  });

  it('getUserByEmail delegates with email and returns its result', async () => {
    const daoResult = { _id: 'u1', email: 'a@b.com' };
    UserDAO.getUserByEmail.mockResolvedValue(daoResult);

    const result = await UserService.getUserByEmail('a@b.com');

    expect(UserDAO.getUserByEmail).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserByEmail).toHaveBeenCalledWith('a@b.com');
    expect(result).toBe(daoResult);
  });

  it('getUserByFilter delegates with filter and returns its result', async () => {
    const filter = { role: 'Admin' };
    const daoResult = { _id: 'u1' };
    UserDAO.getUserByFilter.mockResolvedValue(daoResult);

    const result = await UserService.getUserByFilter(filter);

    expect(UserDAO.getUserByFilter).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserByFilter).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getUserDocByFilter delegates with filter and returns its result', async () => {
    const filter = { email: 'a@b.com' };
    const daoResult = { _id: 'u1' };
    UserDAO.getUserDocByFilter.mockResolvedValue(daoResult);

    const result = await UserService.getUserDocByFilter(filter);

    expect(UserDAO.getUserDocByFilter).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserDocByFilter).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('createGuest delegates with payload and returns its result', async () => {
    const payload = { email: 'g@b.com' };
    const daoResult = { _id: 'u1', ...payload };
    UserDAO.createGuest.mockResolvedValue(daoResult);

    const result = await UserService.createGuest(payload);

    expect(UserDAO.createGuest).toHaveBeenCalledTimes(1);
    expect(UserDAO.createGuest).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('getUserByIdSelect delegates with userId + select and returns its result', async () => {
    const daoResult = { _id: 'u1' };
    UserDAO.getUserByIdSelect.mockResolvedValue(daoResult);

    const result = await UserService.getUserByIdSelect('u1', '+password');

    expect(UserDAO.getUserByIdSelect).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserByIdSelect).toHaveBeenCalledWith('u1', '+password');
    expect(result).toBe(daoResult);
  });

  it('getUserDocWithPasswordByEmail delegates with email and returns its result', async () => {
    const daoResult = { _id: 'u1', password: 'hash' };
    UserDAO.getUserDocWithPasswordByEmail.mockResolvedValue(daoResult);

    const result = await UserService.getUserDocWithPasswordByEmail('a@b.com');

    expect(UserDAO.getUserDocWithPasswordByEmail).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserDocWithPasswordByEmail).toHaveBeenCalledWith(
      'a@b.com'
    );
    expect(result).toBe(daoResult);
  });

  it('touchLastLoginByEmail delegates with email and returns its result', async () => {
    const daoResult = { _id: 'u1' };
    UserDAO.touchLastLoginByEmail.mockResolvedValue(daoResult);

    const result = await UserService.touchLastLoginByEmail('a@b.com');

    expect(UserDAO.touchLastLoginByEmail).toHaveBeenCalledTimes(1);
    expect(UserDAO.touchLastLoginByEmail).toHaveBeenCalledWith('a@b.com');
    expect(result).toBe(daoResult);
  });

  it('touchLastLoginById delegates with userId and returns its result', async () => {
    const daoResult = { _id: 'u1' };
    UserDAO.touchLastLoginById.mockResolvedValue(daoResult);

    const result = await UserService.touchLastLoginById('u1');

    expect(UserDAO.touchLastLoginById).toHaveBeenCalledTimes(1);
    expect(UserDAO.touchLastLoginById).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });

  it('findAgents delegates with filter + select and returns its result', async () => {
    const filter = { role: 'Agent' };
    const daoResult = [{ _id: 'a1' }];
    UserDAO.findAgents.mockResolvedValue(daoResult);

    const result = await UserService.findAgents(filter, 'firstname');

    expect(UserDAO.findAgents).toHaveBeenCalledTimes(1);
    expect(UserDAO.findAgents).toHaveBeenCalledWith(filter, 'firstname');
    expect(result).toBe(daoResult);
  });

  it('findEditors delegates with filter + select and returns its result', async () => {
    const filter = { role: 'Editor' };
    const daoResult = [{ _id: 'e1' }];
    UserDAO.findEditors.mockResolvedValue(daoResult);

    const result = await UserService.findEditors(filter, 'firstname');

    expect(UserDAO.findEditors).toHaveBeenCalledTimes(1);
    expect(UserDAO.findEditors).toHaveBeenCalledWith(filter, 'firstname');
    expect(result).toBe(daoResult);
  });

  it('findAgentById delegates with agentId + select and returns its result', async () => {
    const daoResult = { _id: 'a1' };
    UserDAO.findAgentById.mockResolvedValue(daoResult);

    const result = await UserService.findAgentById('a1', 'firstname');

    expect(UserDAO.findAgentById).toHaveBeenCalledTimes(1);
    expect(UserDAO.findAgentById).toHaveBeenCalledWith('a1', 'firstname');
    expect(result).toBe(daoResult);
  });

  it('getUserDocById delegates with userId and returns its result', async () => {
    const daoResult = { _id: 'u1' };
    UserDAO.getUserDocById.mockResolvedValue(daoResult);

    const result = await UserService.getUserDocById('u1');

    expect(UserDAO.getUserDocById).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserDocById).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });

  it('getAgentDocById delegates with agentId and returns its result', async () => {
    const daoResult = { _id: 'a1' };
    UserDAO.getAgentDocById.mockResolvedValue(daoResult);

    const result = await UserService.getAgentDocById('a1');

    expect(UserDAO.getAgentDocById).toHaveBeenCalledTimes(1);
    expect(UserDAO.getAgentDocById).toHaveBeenCalledWith('a1');
    expect(result).toBe(daoResult);
  });

  it('createUser delegates with role + payload and returns its result', async () => {
    const payload = { email: 'a@b.com' };
    const daoResult = { _id: 'u1', role: 'Agent' };
    UserDAO.createUser.mockResolvedValue(daoResult);

    const result = await UserService.createUser('Agent', payload);

    expect(UserDAO.createUser).toHaveBeenCalledTimes(1);
    expect(UserDAO.createUser).toHaveBeenCalledWith('Agent', payload);
    expect(result).toBe(daoResult);
  });

  it('updateUserWithOptions delegates with userId + fields + options and returns its result', async () => {
    const fields = { firstname: 'Jane' };
    const options = { runValidators: true };
    const daoResult = { _id: 'u1' };
    UserDAO.updateUserWithOptions.mockResolvedValue(daoResult);

    const result = await UserService.updateUserWithOptions(
      'u1',
      fields,
      options
    );

    expect(UserDAO.updateUserWithOptions).toHaveBeenCalledTimes(1);
    expect(UserDAO.updateUserWithOptions).toHaveBeenCalledWith(
      'u1',
      fields,
      options
    );
    expect(result).toBe(daoResult);
  });

  it('updateUserArchiv delegates with userId + isArchived and returns its result', async () => {
    const daoResult = { _id: 'u1', archiv: true };
    UserDAO.updateUserArchiv.mockResolvedValue(daoResult);

    const result = await UserService.updateUserArchiv('u1', true);

    expect(UserDAO.updateUserArchiv).toHaveBeenCalledTimes(1);
    expect(UserDAO.updateUserArchiv).toHaveBeenCalledWith('u1', true);
    expect(result).toBe(daoResult);
  });

  it('deleteUserById delegates with userId and returns its result', async () => {
    const daoResult = { deletedCount: 1 };
    UserDAO.deleteUserById.mockResolvedValue(daoResult);

    const result = await UserService.deleteUserById('u1');

    expect(UserDAO.deleteUserById).toHaveBeenCalledTimes(1);
    expect(UserDAO.deleteUserById).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });

  it('pullStaffFromStudents delegates with userId and returns its result', async () => {
    const daoResult = { modifiedCount: 2 };
    UserDAO.pullStaffFromStudents.mockResolvedValue(daoResult);

    const result = await UserService.pullStaffFromStudents('u1');

    expect(UserDAO.pullStaffFromStudents).toHaveBeenCalledTimes(1);
    expect(UserDAO.pullStaffFromStudents).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });

  it('deleteStudentCascade delegates with userId and returns its result', async () => {
    const daoResult = { deletedCount: 1 };
    UserDAO.deleteStudentCascade.mockResolvedValue(daoResult);

    const result = await UserService.deleteStudentCascade('u1');

    expect(UserDAO.deleteStudentCascade).toHaveBeenCalledTimes(1);
    expect(UserDAO.deleteStudentCascade).toHaveBeenCalledWith('u1');
    expect(result).toBe(daoResult);
  });

  it('getUserRoleCounts delegates to DAO and returns its result', async () => {
    const daoResult = { Agent: 5, Student: 100 };
    UserDAO.getUserRoleCounts.mockResolvedValue(daoResult);

    const result = await UserService.getUserRoleCounts();

    expect(UserDAO.getUserRoleCounts).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUserRoleCounts).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getUsersOverview delegates to DAO and returns its result', async () => {
    const daoResult = [{ _id: 'u1' }];
    UserDAO.getUsersOverview.mockResolvedValue(daoResult);

    const result = await UserService.getUsersOverview();

    expect(UserDAO.getUsersOverview).toHaveBeenCalledTimes(1);
    expect(UserDAO.getUsersOverview).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});
