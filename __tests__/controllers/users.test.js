// Controller UNIT test for controllers/users.
//
// users is a broad controller: list/paginate/count/overview/add/update/archive/
// delete. The handlers are plain (req, res, next) functions (wrapped by
// asyncHandler), so we call them DIRECTLY with fake req/res/next and a MOCKED
// service layer (UserService + TokenService) plus the side-effect deps (email,
// audit, S3 cleanup). No route, no middleware, no supertest, no database. We
// assert ONLY the controller's own work: args forwarded to the services, the
// branching it does, the status + body written to res, and error forwarding to
// next(). Full-stack coverage (a couple of endpoints end to end) lives in
// __tests__/integration/users.test.js.

jest.mock('../../services/users');
jest.mock('../../services/tokens');
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
  updateNotificationEmail: jest.fn().mockResolvedValue(undefined)
}));
// deleteUser empties an S3 directory for student/guest deletes — stub it out so
// no real S3 client is built.
jest.mock('../../utils/modelHelper/versionControl', () => ({
  ...jest.requireActual('../../utils/modelHelper/versionControl'),
  emptyS3Directory: jest.fn().mockResolvedValue(undefined)
}));

const { Role } = require('@taiger-common/core');
const UserService = require('../../services/users');
const TokenService = require('../../services/tokens');
const {
  getUsersCount,
  addUser,
  getUsers,
  getUser,
  updateUserArchivStatus,
  updateUser,
  deleteUser,
  getUsersOverview
} = require('../../controllers/users');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin } = require('../mock/user');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUsers', () => {
  it('returns the unpaginated list when page/limit are absent', async () => {
    const list = [{ _id: 'u1' }, { _id: 'u2' }];
    UserService.getUsers.mockResolvedValue(list);
    const res = mockRes();

    await getUsers(mockReq({ user: admin, query: {} }), res, jest.fn());

    expect(UserService.getUsersPaginated).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: list });
  });

  it('forwards the role filter to the service', async () => {
    UserService.getUsers.mockResolvedValue([]);

    await getUsers(
      mockReq({ user: admin, query: { role: 'Agent' } }),
      mockRes(),
      jest.fn()
    );

    const [filter] = UserService.getUsers.mock.calls[0];
    expect(filter).toMatchObject({ role: 'Agent' });
  });

  it('returns a paginated payload when page/limit are present', async () => {
    UserService.parseUsersPaginationQuery.mockReturnValue({
      page: 1,
      limit: 5
    });
    UserService.getUsersPaginated.mockResolvedValue({
      users: [{ _id: 'u1' }],
      total: 11,
      page: 1,
      limit: 5
    });
    const res = mockRes();

    await getUsers(
      mockReq({ user: admin, query: { page: '1', limit: '5' } }),
      res,
      jest.fn()
    );

    expect(UserService.getUsersPaginated).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 'u1' }],
      total: 11,
      page: 1,
      limit: 5
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    UserService.getUsers.mockRejectedValue(err);
    const next = jest.fn();

    await getUsers(mockReq({ user: admin, query: {} }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getUsersCount', () => {
  it('responds 200 with the role counts from the service', async () => {
    const counts = { Admin: 2, Agent: 3 };
    UserService.getUserRoleCounts.mockResolvedValue(counts);
    const res = mockRes();

    await getUsersCount(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: counts });
  });
});

describe('getUser', () => {
  it('responds 200 with the requested user and forwards req.params.user_id', async () => {
    const found = { _id: 'u7', firstname: 'Joe' };
    UserService.getUserById.mockResolvedValue(found);
    const res = mockRes();

    await getUser(mockReq({ params: { user_id: 'u7' } }), res, jest.fn());

    expect(UserService.getUserById).toHaveBeenCalledWith('u7');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: found });
  });
});

describe('getUsersOverview', () => {
  it('filters out null/missing keys and renames byUniversityProgram -> byUniversity', async () => {
    UserService.getUsersOverview.mockResolvedValue({
      byTargetDegree: [{ degree: 'MSc' }, { degree: null }],
      byApplicationSemester: [{ semester: 'WS24' }, {}],
      byTargetField: [{ field: 'CS' }],
      byProgramLanguage: [{ language: 'English' }],
      byUniversityProgram: [{ university: 'TUM' }]
    });
    const res = mockRes();

    await getUsersOverview(mockReq(), res, jest.fn());

    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.byTargetDegree).toEqual([{ degree: 'MSc' }]);
    expect(body.data.byApplicationSemester).toEqual([{ semester: 'WS24' }]);
    expect(body.data.byUniversity).toEqual([{ university: 'TUM' }]);
  });
});

describe('addUser', () => {
  it('creates a user + activation token and responds 201, then calls next() for the audit log', async () => {
    UserService.getUserByEmail.mockResolvedValue(null);
    UserService.createUser.mockResolvedValue({
      _id: 'newId',
      firstname: 'New',
      lastname: 'User',
      email: 'new@example.com'
    });
    TokenService.createToken.mockResolvedValue({});
    UserService.getUsers.mockResolvedValue([{ _id: 'newId' }]);
    const res = mockRes();
    const next = jest.fn();

    await addUser(
      mockReq({
        user: admin,
        body: {
          firstname: 'New',
          lastname: 'User',
          email: 'new@example.com',
          role: Role.Editor
        }
      }),
      res,
      next
    );

    const [role] = UserService.createUser.mock.calls[0];
    expect(role).toBe(Role.Editor);
    expect(TokenService.createToken).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.newUser).toBe('newId');
    // addUser hands off to the auditLog middleware via next().
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects (409) when the email already exists and never creates a user', async () => {
    UserService.getUserByEmail.mockResolvedValue({ _id: 'exists' });
    const next = jest.fn();

    await addUser(
      mockReq({
        user: admin,
        body: {
          firstname: 'Dup',
          lastname: 'User',
          email: 'dup@example.com',
          role: Role.Editor
        }
      }),
      mockRes(),
      next
    );

    expect(UserService.createUser).not.toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(409);
  });

  it('rejects (409) creating an Admin', async () => {
    UserService.getUserByEmail.mockResolvedValue(null);
    const next = jest.fn();

    await addUser(
      mockReq({
        user: admin,
        body: {
          firstname: 'Adm',
          lastname: 'In',
          email: 'admin2@example.com',
          role: Role.Admin
        }
      }),
      mockRes(),
      next
    );

    expect(UserService.createUser).not.toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(409);
  });
});

describe('updateUser', () => {
  it('updates role/email and responds 200 with the updated user', async () => {
    UserService.updateUserWithOptions.mockResolvedValue({
      _id: 'u3',
      role: Role.Editor,
      email: 'e@example.com'
    });
    UserService.getUserById.mockResolvedValue({
      _id: 'u3',
      firstname: 'E',
      lastname: 'D',
      email: 'e@example.com'
    });
    const res = mockRes();

    await updateUser(
      mockReq({
        params: { user_id: 'u3' },
        body: { email: 'e@example.com', role: Role.Editor }
      }),
      res,
      jest.fn()
    );

    const [id, fields] = UserService.updateUserWithOptions.mock.calls[0];
    expect(id).toBe('u3');
    expect(fields).toEqual({ email: 'e@example.com', role: Role.Editor });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data).toMatchObject({ role: Role.Editor });
  });

  it('refuses (409) to promote a user to Admin and never touches the service', async () => {
    const next = jest.fn();

    await updateUser(
      mockReq({
        params: { user_id: 'u4' },
        body: { email: 'a@example.com', role: Role.Admin }
      }),
      mockRes(),
      next
    );

    expect(UserService.updateUserWithOptions).not.toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(409);
  });
});

describe('updateUserArchivStatus', () => {
  it('archives the user and responds 200 with the refreshed list', async () => {
    UserService.updateUserArchiv.mockResolvedValue({});
    UserService.getUsers.mockResolvedValue([{ _id: 'u1' }]);
    const res = mockRes();

    await updateUserArchivStatus(
      mockReq({ params: { user_id: 'u1' }, body: { isArchived: true } }),
      res,
      jest.fn()
    );

    expect(UserService.updateUserArchiv).toHaveBeenCalledWith('u1', true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 'u1' }]
    });
  });
});

describe('deleteUser', () => {
  it('Admin: deletes via deleteUserById', async () => {
    UserService.getUserById.mockResolvedValue({ role: Role.Admin });
    UserService.deleteUserById.mockResolvedValue({});
    const res = mockRes();

    await deleteUser(mockReq({ params: { user_id: 'u1' } }), res, jest.fn());

    expect(UserService.deleteUserById).toHaveBeenCalledWith('u1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('Agent: pulls the staff member from students, then deletes', async () => {
    UserService.getUserById.mockResolvedValue({ role: Role.Agent });
    UserService.pullStaffFromStudents.mockResolvedValue([]);
    UserService.deleteUserById.mockResolvedValue({});
    const res = mockRes();

    await deleteUser(mockReq({ params: { user_id: 'u2' } }), res, jest.fn());

    expect(UserService.pullStaffFromStudents).toHaveBeenCalledWith('u2');
    expect(UserService.deleteUserById).toHaveBeenCalledWith('u2');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('Student: cascades the student delete', async () => {
    UserService.getUserById.mockResolvedValue({ role: Role.Student });
    UserService.deleteStudentCascade.mockResolvedValue({});
    const res = mockRes();

    await deleteUser(mockReq({ params: { user_id: 'u3' } }), res, jest.fn());

    expect(UserService.deleteStudentCascade).toHaveBeenCalledWith('u3');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
