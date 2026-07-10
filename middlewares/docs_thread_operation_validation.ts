import { NextFunction, Request, Response } from 'express';
import type { IDocumentthread } from '@taiger-common/model';
import { ErrorResponse } from '../common/errors';
import { asyncHandler } from './error-handler';
import DocumentThreadService from '../services/documentthreads';

export const doc_thread_ops_validator = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      params: { messagesThreadId }
    } = req;
    const document_thread = (await DocumentThreadService.getThreadByIdLean(
      String(messagesThreadId)
    )) as IDocumentthread | null;
    if (document_thread?.isFinalVersion) {
      return next(
        new ErrorResponse(
          423,
          'The finished thread cannot be modified. Please undo finish and do the operation again.'
        )
      );
    }
    next();
  }
);
