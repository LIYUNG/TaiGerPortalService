// Unit tests for utils/queryFunctions.js
//
// Two cache-backed lookups wrapped by asyncHandler. We mock node-cache, the
// logger, and the Permission/Student services so nothing touches a DB or a real
// cache. Each lookup has a cache-miss path (service queried + cache.set) and a
// cache-hit path (service NOT queried).

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: (...a) => mockGet(...a),
    set: (...a) => mockSet(...a)
  }
}));
jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));
jest.mock('../../services/permissions');
jest.mock('../../services/students');

const PermissionService = require('../../services/permissions');
const StudentService = require('../../services/students');
const {
  getPermission,
  getCachedStudentPermission
} = require('../../utils/queryFunctions');

const user = { _id: { toString: () => 'user-1' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPermission', () => {
  it('returns the cached permission on a cache hit (no service call)', async () => {
    const cached = { canAssignEditors: true };
    mockGet.mockReturnValue(cached);

    const result = await getPermission({}, user);

    expect(result).toBe(cached);
    expect(PermissionService.getPermissionByUserId).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('queries the service and caches it on a cache miss', async () => {
    mockGet.mockReturnValue(undefined);
    const perms = { canAssignAgents: true };
    PermissionService.getPermissionByUserId.mockResolvedValue(perms);
    mockSet.mockReturnValue(true);

    const result = await getPermission({}, user);

    expect(PermissionService.getPermissionByUserId).toHaveBeenCalledWith(
      user._id
    );
    expect(mockSet).toHaveBeenCalledWith('/permission/user-1', perms);
    expect(result).toBe(perms);
  });

  it('returns undefined when the cache.set fails (success falsy)', async () => {
    mockGet.mockReturnValue(undefined);
    PermissionService.getPermissionByUserId.mockResolvedValue({ x: 1 });
    mockSet.mockReturnValue(false);

    const result = await getPermission({}, user);

    expect(result).toBeUndefined();
  });
});

describe('getCachedStudentPermission', () => {
  it('returns the cached student on a cache hit', async () => {
    const cached = { agents: [], editors: [] };
    mockGet.mockReturnValue(cached);

    const result = await getCachedStudentPermission({}, 'stu-1');

    expect(result).toBe(cached);
    expect(StudentService.getStudentByIdSelect).not.toHaveBeenCalled();
  });

  it('queries the student service and caches on a miss', async () => {
    mockGet.mockReturnValue(undefined);
    const student = { agents: ['a'], editors: ['e'] };
    StudentService.getStudentByIdSelect.mockResolvedValue(student);
    mockSet.mockReturnValue(true);

    const result = await getCachedStudentPermission({}, 'stu-1');

    expect(StudentService.getStudentByIdSelect).toHaveBeenCalledWith(
      'stu-1',
      'agents editors'
    );
    expect(mockSet).toHaveBeenCalledWith('/filter/studentId/stu-1', student);
    expect(result).toBe(student);
  });

  it('returns undefined when the cache.set fails on a miss', async () => {
    mockGet.mockReturnValue(undefined);
    StudentService.getStudentByIdSelect.mockResolvedValue({ agents: [] });
    mockSet.mockReturnValue(false);

    const result = await getCachedStudentPermission({}, 'stu-1');

    expect(result).toBeUndefined();
  });
});
