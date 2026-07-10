// Unit tests for middlewares/editorIdsBodyFilter.js
//
// Validates that the editor ids in the request body match the thread's student's
// editors (for non-Essay threads). asyncHandler forwards next(err). We mock the
// role guards and DocumentThreadService.getThreadDocByIdPopulated. No DB.

jest.mock('@taiger-common/core', () => ({
  ...jest.requireActual('@taiger-common/core'),
  is_TaiGer_Agent: jest.fn(),
  is_TaiGer_Editor: jest.fn()
}));
// Stub the model registry so the auto-mocked service doesn't compile Mongoose.
jest.mock('../../models', () => ({}));
jest.mock('../../services/documentthreads');

import {
  is_TaiGer_Agent as is_TaiGer_Agent_real,
  is_TaiGer_Editor as is_TaiGer_Editor_real
} from '@taiger-common/core';
import DocumentThreadServiceReal from '../../services/documentthreads';
import { ErrorResponse } from '../../common/errors';
import { editorIdsBodyFilter } from '../../middlewares/editorIdsBodyFilter';

const is_TaiGer_Agent = is_TaiGer_Agent_real as unknown as jest.Mock;
const is_TaiGer_Editor = is_TaiGer_Editor_real as unknown as jest.Mock;
const DocumentThreadService = DocumentThreadServiceReal as unknown as Record<
  string,
  jest.Mock
>;

const makeReq = (user: any, body: any, messagesThreadId = 'thread-1'): any => ({
  user,
  body,
  params: { messagesThreadId }
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('editorIdsBodyFilter', () => {
  it('calls next() without checks for non Agent/Editor roles', async () => {
    is_TaiGer_Agent.mockReturnValue(false);
    is_TaiGer_Editor.mockReturnValue(false);
    const next = jest.fn();

    await editorIdsBodyFilter(makeReq({ _id: 'u1' }, {}), {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(
      DocumentThreadService.getThreadDocByIdPopulated
    ).not.toHaveBeenCalled();
  });

  it('skips validation for Essay threads', async () => {
    is_TaiGer_Agent.mockReturnValue(true);
    is_TaiGer_Editor.mockReturnValue(false);
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      file_type: 'Essay',
      student_id: { editors: [{ _id: { toString: () => 'e1' } }] }
    });
    const next = jest.fn();

    await editorIdsBodyFilter(makeReq({ _id: 'u1' }, {}), {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with 403 when a thread editor is missing from the body keys', async () => {
    is_TaiGer_Agent.mockReturnValue(true);
    is_TaiGer_Editor.mockReturnValue(false);
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      file_type: 'ML',
      student_id: {
        editors: [{ _id: { toString: () => 'e1' } }]
      }
    });
    const next = jest.fn();

    // body keys do not include 'e1'
    await editorIdsBodyFilter(
      makeReq({ _id: 'u1' }, { e2: true }),
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ErrorResponse);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('passes when every thread editor is present in the body keys', async () => {
    is_TaiGer_Agent.mockReturnValue(false);
    is_TaiGer_Editor.mockReturnValue(true);
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      file_type: 'ML',
      student_id: {
        editors: [{ _id: { toString: () => 'e1' } }]
      }
    });
    const next = jest.fn();

    await editorIdsBodyFilter(
      makeReq({ _id: 'u1' }, { e1: true }),
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('passes when the thread has no editors array', async () => {
    is_TaiGer_Agent.mockReturnValue(true);
    is_TaiGer_Editor.mockReturnValue(false);
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      file_type: 'ML',
      student_id: {}
    });
    const next = jest.fn();

    await editorIdsBodyFilter(makeReq({ _id: 'u1' }, {}), {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });
});
