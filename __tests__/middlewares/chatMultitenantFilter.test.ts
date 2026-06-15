import { Role } from '@taiger-common/core';

import { chatMultitenantFilter } from '../../middlewares/chatMultitenantFilter';
import { ErrorResponse } from '../../common/errors';
import { ten_minutes_cache } from '../../cache/node-cache';
import { getPermission } from '../../utils/queryFunctions';
import StudentService from '../../services/students';
import logger from '../../services/logger';

jest.mock('../../utils/queryFunctions');
jest.mock('../../services/students');
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: jest.fn(),
    set: jest.fn()
  }
}));

describe('chatMultitenantFilter', () => {
  let req, res, next;

  beforeEach(() => {
    res = {};
    next = jest.fn();
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    ten_minutes_cache.get.mockReturnValue(undefined);
    ten_minutes_cache.set.mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for non agent/editor roles without checks', async () => {
    req = {
      user: { role: Role.Admin, _id: 'admin1' },
      params: { studentId: 'stu1' }
    };
    await chatMultitenantFilter(req, res, next);
    expect(StudentService.getStudentByIdSelect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('loads student from service on cache miss and calls next() when agent is assigned', async () => {
    req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { studentId: 'stu1' }
    };
    ten_minutes_cache.get.mockReturnValue(undefined);
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [{ toString: () => 'agent1' }],
      editors: []
    });
    getPermission.mockResolvedValue({ canAccessAllChat: false });

    await chatMultitenantFilter(req, res, next);

    expect(StudentService.getStudentByIdSelect).toHaveBeenCalledWith(
      'stu1',
      'agents editors'
    );
    expect(ten_minutes_cache.set).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('uses cached student (cache hit) and calls next() when editor is assigned', async () => {
    req = {
      user: { role: Role.Editor, _id: 'editor1' },
      params: { studentId: 'stu1' }
    };
    ten_minutes_cache.get.mockReturnValue({
      agents: [],
      editors: [{ toString: () => 'editor1' }]
    });
    getPermission.mockResolvedValue({ canAccessAllChat: false });

    await chatMultitenantFilter(req, res, next);

    expect(StudentService.getStudentByIdSelect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() via canAccessAllChat permission even if not assigned', async () => {
    req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { studentId: 'stu1' }
    };
    ten_minutes_cache.get.mockReturnValue({ agents: [], editors: [] });
    getPermission.mockResolvedValue({ canAccessAllChat: true });

    await chatMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('errors 403 when user is neither assigned nor has canAccessAllChat', async () => {
    req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { studentId: 'stu1' }
    };
    ten_minutes_cache.get.mockReturnValue({
      agents: [{ toString: () => 'otherAgent' }],
      editors: [{ toString: () => 'otherEditor' }]
    });
    getPermission.mockResolvedValue({ canAccessAllChat: false });

    await chatMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('passes an error to next when cache.set fails and cachedStudent stays undefined', async () => {
    // On cache miss, cachedStudent is only assigned when cache.set succeeds.
    // If set() returns false, cachedStudent is undefined and accessing
    // .agents throws, which asyncHandler forwards to next().
    req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { studentId: 'stu1' }
    };
    ten_minutes_cache.get.mockReturnValue(undefined);
    ten_minutes_cache.set.mockReturnValue(false);
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [{ toString: () => 'agent1' }],
      editors: []
    });
    getPermission.mockResolvedValue({ canAccessAllChat: false });

    await chatMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('handles students with no agents/editors arrays (optional chaining) -> 403', async () => {
    req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { studentId: 'stu1' }
    };
    ten_minutes_cache.get.mockReturnValue({});
    getPermission.mockResolvedValue(undefined);

    await chatMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });
});
