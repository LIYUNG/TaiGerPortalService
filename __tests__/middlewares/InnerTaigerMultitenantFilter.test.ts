// Unit tests for middlewares/InnerTaigerMultitenantFilter.js
//
// Guards student-document access for Editors/Agents. asyncHandler forwards
// throws/next(err) to `next`. We mock the role guards, queryFunctions
// (getPermission + getCachedStudentPermission), and assert next() vs
// next(ErrorResponse). No DB.

jest.mock('@taiger-common/core', () => ({
  is_TaiGer_Editor: jest.fn(),
  is_TaiGer_Agent: jest.fn()
}));
jest.mock('../../utils/queryFunctions', () => ({
  getPermission: jest.fn(),
  getCachedStudentPermission: jest.fn()
}));

const { is_TaiGer_Editor, is_TaiGer_Agent } = require('@taiger-common/core');
const {
  getPermission,
  getCachedStudentPermission
} = require('../../utils/queryFunctions');
const { ErrorResponse } = require('../../common/errors');
const {
  InnerTaigerMultitenantFilter
} = require('../../middlewares/InnerTaigerMultitenantFilter');

const makeReq = (user, studentId = 'stu-1') => ({
  user,
  params: { studentId }
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InnerTaigerMultitenantFilter', () => {
  it('calls next() without checks for non Editor/Agent roles', async () => {
    is_TaiGer_Editor.mockReturnValue(false);
    is_TaiGer_Agent.mockReturnValue(false);
    const next = jest.fn();

    await InnerTaigerMultitenantFilter(makeReq({ _id: 'u1' }), {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(getCachedStudentPermission).not.toHaveBeenCalled();
  });

  it('passes a 404 to next when the student is not found (length 0)', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({});
    getCachedStudentPermission.mockResolvedValue({ length: 0 });
    const next = jest.fn();

    await InnerTaigerMultitenantFilter(
      makeReq({ _id: { toString: () => 'u1' } }),
      {},
      next
    );

    // both the 404 and the trailing unconditional next() fire
    expect(next.mock.calls[0][0]).toBeInstanceOf(ErrorResponse);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('passes a 403 to next when the user owns neither agents nor editors and lacks permission', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({ canModifyAllBaseDocuments: false });
    getCachedStudentPermission.mockResolvedValue({
      agents: ['someone'],
      editors: ['another']
    });
    const next = jest.fn();

    await InnerTaigerMultitenantFilter(
      makeReq({ _id: { toString: () => 'u1' } }),
      {},
      next
    );

    expect(next.mock.calls[0][0]).toBeInstanceOf(ErrorResponse);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('allows access (final next with no error) when the user is one of the agents', async () => {
    is_TaiGer_Editor.mockReturnValue(false);
    is_TaiGer_Agent.mockReturnValue(true);
    getPermission.mockResolvedValue({});
    getCachedStudentPermission.mockResolvedValue({
      agents: [{ toString: () => 'u1' }],
      editors: []
    });
    const next = jest.fn();

    await InnerTaigerMultitenantFilter(
      makeReq({ _id: { toString: () => 'u1' } }),
      {},
      next
    );

    // no error was passed: every next() call had no args
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls.every((c) => c.length === 0)).toBe(true);
  });

  it('allows access when canModifyAllBaseDocuments is set, even without ownership', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({ canModifyAllBaseDocuments: true });
    getCachedStudentPermission.mockResolvedValue({
      agents: [{ toString: () => 'other' }],
      editors: []
    });
    const next = jest.fn();

    await InnerTaigerMultitenantFilter(
      makeReq({ _id: { toString: () => 'u1' } }),
      {},
      next
    );

    expect(next.mock.calls.every((c) => c.length === 0)).toBe(true);
  });
});
