import { is_TaiGer_Agent, is_TaiGer_Editor } from '@taiger-common/core';
import { NextFunction, Request, Response } from 'express';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from './error-handler';
import DocumentThreadService from '../services/documentthreads';

export const editorIdsBodyFilter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      params: { messagesThreadId },
      user,
      body: editorsId
    } = req;

    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const thread = await DocumentThreadService.getThreadDocByIdPopulated(
        messagesThreadId,
        [
          ['student_id'],
          [{ path: 'student_id', populate: { path: 'editors', model: 'User' } }]
        ]
      );
      if (thread.file_type !== 'Essay') {
        const keys = Object.keys(editorsId);
        if (
          thread.student_id.editors?.some(
            (editor) => !keys.includes(editor._id.toString())
          )
        ) {
          return next(new ErrorResponse(403, 'Editor Id wrong.'));
        }
      }
    }

    next();
  }
);
