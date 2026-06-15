import { Role } from '@taiger-common/core';

import {
  docThreadMultitenant_filter,
  surveyMultitenantFilter
} from '../../middlewares/documentThreadMultitenantFilter';
import { ErrorResponse } from '../../common/errors';
import DocumentThreadService from '../../services/documentthreads';
import SurveyInputService from '../../services/surveyInputs';
import logger from '../../services/logger';

jest.mock('../../services/documentthreads');
jest.mock('../../services/surveyInputs');

describe('docThreadMultitenant_filter', () => {
  let req, res, next;

  beforeEach(() => {
    res = {};
    next = jest.fn();
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for non-student/non-guest roles without touching the service', async () => {
    req = {
      user: { role: Role.Agent, _id: 'agent1' },
      params: { messagesThreadId: 't1' },
      originalUrl: '/api/threads/t1'
    };
    await docThreadMultitenant_filter(req, res, next);
    expect(
      DocumentThreadService.findThreadByIdPopulated
    ).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when student owns the thread', async () => {
    req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { messagesThreadId: 't1' },
      originalUrl: '/api/threads/t1'
    };
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: { toString: () => 'stu1' } }
    });
    await docThreadMultitenant_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('errors 404 when thread not found for a student', async () => {
    req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { messagesThreadId: 't1' },
      originalUrl: '/api/threads/t1'
    };
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue(null);
    await docThreadMultitenant_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(404);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('errors 403 when student does not own the thread', async () => {
    req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { messagesThreadId: 't1' },
      originalUrl: '/api/threads/t1'
    };
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: { toString: () => 'otherStudent' } }
    });
    await docThreadMultitenant_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('applies the same ownership check for Guest role', async () => {
    req = {
      user: { role: Role.Guest, _id: 'guest1' },
      params: { messagesThreadId: 't1' },
      originalUrl: '/api/threads/t1'
    };
    DocumentThreadService.findThreadByIdPopulated.mockResolvedValue({
      student_id: { _id: { toString: () => 'guest1' } }
    });
    await docThreadMultitenant_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('surveyMultitenantFilter', () => {
  let res, next;

  beforeEach(() => {
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for non-student/non-guest roles', async () => {
    const req = {
      user: { role: Role.Admin, _id: 'admin1' },
      params: {},
      body: {}
    };
    await surveyMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(SurveyInputService.getSurveyInputById).not.toHaveBeenCalled();
  });

  it('errors 403 on POST when created survey belongs to another student', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: {},
      body: { input: { studentId: { toString: () => 'otherStudent' } } }
    };
    await surveyMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].message).toBe(
      'Not allowed to create/edit other resource.'
    );
  });

  it('errors 403 on PUT/DELETE when the stored survey belongs to another student', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { surveyInputId: 's1' },
      body: {}
    };
    SurveyInputService.getSurveyInputById.mockResolvedValue({
      studentId: { toString: () => 'otherStudent' }
    });
    await surveyMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].message).toBe(
      'Not allowed to access other resource.'
    );
  });

  it('calls next() when the stored survey belongs to the requesting student', async () => {
    const req = {
      user: { role: Role.Student, _id: 'stu1' },
      params: { surveyInputId: 's1' },
      body: {}
    };
    SurveyInputService.getSurveyInputById.mockResolvedValue({
      studentId: { toString: () => 'stu1' }
    });
    await surveyMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes the POST ownership check when survey belongs to the student (Guest role)', async () => {
    const req = {
      user: { role: Role.Guest, _id: 'guest1' },
      params: { surveyInputId: 's1' },
      body: { input: { studentId: { toString: () => 'guest1' } } }
    };
    SurveyInputService.getSurveyInputById.mockResolvedValue({
      studentId: { toString: () => 'guest1' }
    });
    await surveyMultitenantFilter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
