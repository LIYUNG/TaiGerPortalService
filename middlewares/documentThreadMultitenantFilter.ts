import { Role, is_TaiGer_Student, is_TaiGer_Guest } from '@taiger-common/core';
import { NextFunction, Request, Response } from 'express';

import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import { asyncHandler } from './error-handler';
import DocumentThreadService from '../services/documentthreads';
import SurveyInputService from '../services/surveyInputs';

export const docThreadMultitenant_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      user,
      params: { messagesThreadId }
    } = req;
    if (is_TaiGer_Student(user) || is_TaiGer_Guest(user)) {
      const document_thread =
        await DocumentThreadService.findThreadByIdPopulated(messagesThreadId, [
          ['student_id', 'firstname lastname role ']
        ]);
      if (!document_thread) {
        logger.warn(`${req.originalUrl}: Thread not found!`);
        return next(
          new ErrorResponse(404, `${req.originalUrl}: Thread not found!`)
        );
      }
      if (document_thread.student_id?._id.toString() !== user._id.toString()) {
        logger.warn(
          `${req.originalUrl}: Not allowed to access other resource.`
        );
        return next(
          new ErrorResponse(
            403,
            `${req.originalUrl}: Not allowed to access other resource.`
          )
        );
      }
    }
    next();
  }
);

export const surveyMultitenantFilter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      user,
      params: { surveyInputId }
    } = req;

    if (user.role === Role.Student || user.role === Role.Guest) {
      // On POST: where surveyInputId not yet exist, check if created document is assign to the user
      const surveyDocument = req?.body?.input;
      if (
        !surveyInputId &&
        surveyDocument?.studentId.toString() !== user._id.toString()
      ) {
        return next(
          new ErrorResponse(403, 'Not allowed to create/edit other resource.')
        );
      }

      // On PUT/DELETE: use surveyInputId to validate the document belongs to the user
      const surveyInputs = await SurveyInputService.getSurveyInputById(
        surveyInputId
      );
      if (surveyInputs.studentId.toString() !== user._id.toString()) {
        return next(
          new ErrorResponse(403, 'Not allowed to access other resource.')
        );
      }

      if (!surveyInputs) {
        return next(new ErrorResponse(404, 'Survey input not found!'));
      }
    }
    next();
  }
);
