import { is_TaiGer_Agent, is_TaiGer_Editor } from '@taiger-common/core';
import { NextFunction, Request, Response } from 'express';
import type { IDocumentthread, IStudent, IUser } from '@taiger-common/model';
import type { Types } from 'mongoose';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from './error-handler';
import DocumentThreadService from '../services/documentthreads';

// Populated by the `protect` auth middleware before this filter runs, so it is
// always present at this point despite `Request.user` being declared optional.
type AuthUser = IUser & { _id: Types.ObjectId | string };

// Populated via getThreadDocByIdPopulated(..., [['student_id'], [{ path:
// 'student_id', populate: { path: 'editors', ... } }]]) below.
type PopulatedDocumentThread = IDocumentthread & {
  student_id: IStudent & {
    editors?: (IUser & { _id: Types.ObjectId })[];
  };
};

export const editorIdsBodyFilter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      params: { messagesThreadId },
      body: editorsId
    } = req;
    const user = req.user as AuthUser;

    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const thread = (await DocumentThreadService.getThreadDocByIdPopulated(
        String(messagesThreadId),
        [
          ['student_id'],
          [{ path: 'student_id', populate: { path: 'editors', model: 'User' } }]
        ]
      )) as PopulatedDocumentThread;
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
