// Unit tests for middlewares/AssignOutsourcerFilter.js
//
// Guards document-thread access for Editors/Agents. The middleware reads the
// thread (DocumentThreadService.findThreadByIdPopulated), the student
// (StudentService.getStudentByIdSelect) and the caller's permissions
// (getPermission). asyncHandler forwards throws to `next`. We mock the role
// guards + all three collaborators; no DB.

jest.mock('@taiger-common/core', () => ({
  ...jest.requireActual('@taiger-common/core'),
  is_TaiGer_Editor: jest.fn(),
  is_TaiGer_Agent: jest.fn()
}));
jest.mock('../../utils/queryFunctions', () => ({ getPermission: jest.fn() }));
// Stub the model registry so the auto-mocked services don't compile Mongoose.
jest.mock('../../models', () => ({}));
jest.mock('../../services/documentthreads');
jest.mock('../../services/students');

const { is_TaiGer_Editor, is_TaiGer_Agent } = require('@taiger-common/core');
const { getPermission } = require('../../utils/queryFunctions');
const DocumentThreadService = require('../../services/documentthreads');
const StudentService = require('../../services/students');
const { ErrorResponse } = require('../../common/errors');
const {
  AssignOutsourcerFilter
} = require('../../middlewares/AssignOutsourcerFilter');

const makeReq = (user, messagesThreadId = 'thread-1') => ({
  user,
  params: { messagesThreadId }
});

const id = (v) => ({ toString: () => v });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AssignOutsourcerFilter', () => {
  it('calls next() for non Editor/Agent roles without any lookups', async () => {
    is_TaiGer_Editor.mockReturnValue(false);
    is_TaiGer_Agent.mockReturnValue(false);
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: 'u1' }), {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(
      DocumentThreadService.findThreadByIdPopulated
    ).not.toHaveBeenCalled();
  });

  it('throws 403 when the student is not found', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({});
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: id('stu-1'), agents: [] },
      outsourced_user_id: [],
      file_type: 'ML'
    });
    StudentService.getStudentByIdSelect.mockResolvedValue(null);
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: id('u1') }), {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ErrorResponse);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('calls next() when the user is one of the student staff', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({});
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: id('stu-1'), agents: [] },
      outsourced_user_id: [],
      file_type: 'ML'
    });
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [],
      editors: [id('u1')]
    });
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: id('u1') }), {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when the user is an allowed outsourcer', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({});
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: id('stu-1'), agents: [] },
      outsourced_user_id: [id('u1')],
      file_type: 'Essay'
    });
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [],
      editors: []
    });
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: id('u1') }), {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when the user is an agent of a non-Essay thread', async () => {
    is_TaiGer_Editor.mockReturnValue(false);
    is_TaiGer_Agent.mockReturnValue(true);
    getPermission.mockResolvedValue({});
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: id('stu-1'), agents: [id('u1')] },
      outsourced_user_id: [],
      file_type: 'ML'
    });
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [],
      editors: []
    });
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: id('u1') }), {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when permissions grant canAssignEditors', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({ canAssignEditors: true });
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: id('stu-1'), agents: [] },
      outsourced_user_id: [],
      file_type: 'ML'
    });
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [],
      editors: []
    });
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: id('u1') }), {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('throws 403 (administrator2) when nothing grants access', async () => {
    is_TaiGer_Editor.mockReturnValue(true);
    is_TaiGer_Agent.mockReturnValue(false);
    getPermission.mockResolvedValue({});
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: id('stu-1'), agents: [] },
      outsourced_user_id: [],
      file_type: 'ML'
    });
    StudentService.getStudentByIdSelect.mockResolvedValue({
      agents: [id('other')],
      editors: [id('another')]
    });
    const next = jest.fn();

    await AssignOutsourcerFilter(makeReq({ _id: id('u1') }), {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ErrorResponse);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].message).toContain('administrator2');
  });
});
