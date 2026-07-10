import { Role } from '@taiger-common/core';

import {
  interviewMultitenantFilter,
  interviewMultitenantReadOnlyFilter
} from '../../middlewares/interviewMultitenantFilter';
import { ErrorResponse } from '../../common/errors';
import { getPermission } from '../../utils/queryFunctions';
import InterviewServiceReal from '../../services/interviews';

jest.mock('../../utils/queryFunctions');
jest.mock('../../services/interviews');

const InterviewService = InterviewServiceReal as unknown as Record<
  string,
  jest.Mock
>;

const idStr = (s: any) => ({ toString: () => s });

describe('interviewMultitenantFilter', () => {
  let res: any, next: any;

  beforeEach(() => {
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for editor/agent assigned as agent on the interview', async () => {
    const req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: { agents: [idStr('agent1')], editors: [] },
      trainer_id: []
    });
    (getPermission as jest.Mock).mockResolvedValue({});
    await interviewMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() for editor assigned as editor on the interview', async () => {
    const req = {
      user: { role: Role.Editor, _id: 'editor1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: { agents: [], editors: [idStr('editor1')] },
      trainer_id: []
    });
    (getPermission as jest.Mock).mockResolvedValue({});
    await interviewMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when user is the trainer', async () => {
    const req = {
      user: { role: Role.Agent, _id: 'trainerX' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: { agents: [], editors: [] },
      trainer_id: [idStr('trainerX')]
    });
    (getPermission as jest.Mock).mockResolvedValue({});
    await interviewMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() via canAssignEditors permission even when not assigned', async () => {
    const req = {
      user: { role: Role.Agent, _id: 'agentZ' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: { agents: [], editors: [] },
      trainer_id: []
    });
    (getPermission as jest.Mock).mockResolvedValue({ canAssignEditors: true });
    await interviewMultitenantFilter(req, res, next);
    // Only one (final) next() call, with no error
    expect(next).toHaveBeenLastCalledWith();
  });

  it('errors 403 for editor/agent not assigned and lacking permissions', async () => {
    const req = {
      user: { role: Role.Agent, _id: 'agentZ' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: { agents: [idStr('other')], editors: [idStr('other2')] },
      trainer_id: [idStr('trainerY')]
    });
    (getPermission as jest.Mock).mockResolvedValue({
      canAssignEditors: false,
      canAssignAgents: false
    });
    await interviewMultitenantFilter(req, res, next);
    const errCall = next.mock.calls.find(
      (c: any) => c[0] instanceof ErrorResponse
    );
    expect(errCall).toBeDefined();
    expect(errCall[0].statusCode).toBe(403);
  });

  it('passes 404 to next when interview not found for agent/editor', async () => {
    const req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { interview_id: 'i1' }
    };
    // first call returns falsy interview -> 404 branch; but code then dereferences
    // interview.student_id, which throws. asyncHandler forwards to next.
    InterviewService.findInterviewByIdPopulated.mockResolvedValue(null);
    (getPermission as jest.Mock).mockResolvedValue({});
    await interviewMultitenantFilter(req, res, next);
    const errCall = next.mock.calls.find(
      (c: any) => c[0] instanceof ErrorResponse
    );
    expect(errCall).toBeDefined();
    expect(errCall[0].statusCode).toBe(404);
  });

  it('errors 403 for Student accessing another student interview', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: idStr('otherStudent')
    });
    await interviewMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('calls next() for Student accessing own interview', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: idStr('stu1')
    });
    await interviewMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() for Guest when interview has no student_id', async () => {
    const req = {
      user: { role: Role.Guest, _id: 'guest1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: undefined
    });
    await interviewMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('interviewMultitenantReadOnlyFilter', () => {
  let res: any, next: any;

  beforeEach(() => {
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for non student/guest roles without service call', async () => {
    const req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { interview_id: 'i1' }
    };
    await interviewMultitenantReadOnlyFilter(req, res, next);
    expect(InterviewService.findByIdRaw).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('errors 403 for Student reading another student interview', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findByIdRaw.mockResolvedValue({
      student_id: idStr('otherStudent')
    });
    await interviewMultitenantReadOnlyFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('calls next() for Student reading own interview', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findByIdRaw.mockResolvedValue({
      student_id: idStr('stu1')
    });
    await interviewMultitenantReadOnlyFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() for Guest when interview is missing/has no student_id', async () => {
    const req = {
      user: { role: Role.Guest, _id: 'guest1' },
      params: { interview_id: 'i1' }
    };
    InterviewService.findByIdRaw.mockResolvedValue(null);
    await interviewMultitenantReadOnlyFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
