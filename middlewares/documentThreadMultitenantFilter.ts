import { Role, is_TaiGer_Student, is_TaiGer_Guest } from '@taiger-common/core';
import { NextFunction, Request, Response } from 'express';
import type { IUser, ISurveyInput } from '@taiger-common/model';
import type { Types } from 'mongoose';

import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import { asyncHandler } from './error-handler';
import DocumentThreadService from '../services/documentthreads';
import SurveyInputService from '../services/surveyInputs';

// Populated by the `protect` auth middleware before this filter runs, so it is
// always present at this point despite `Request.user` being declared optional.
type AuthUser = IUser & { _id: Types.ObjectId | string };

export const docThreadMultitenant_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      params: { messagesThreadId }
    } = req;
    const user = req.user as AuthUser;
    if (is_TaiGer_Student(user) || is_TaiGer_Guest(user)) {
      const document_thread =
        await DocumentThreadService.findThreadByIdPopulated(
          String(messagesThreadId),
          [['student_id', 'firstname lastname role ']]
        );
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
      params: { surveyInputId }
    } = req;
    const user = req.user as AuthUser;

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
      const surveyInputs = (await SurveyInputService.getSurveyInputById(
        String(surveyInputId)
      )) as (ISurveyInput & { _id: Types.ObjectId | string }) | null;
      // NOTE: pre-existing ordering issue — `surveyInputs` is dereferenced here
      // before the not-found check below. Preserved as-is (see report); the
      // non-null assertion only satisfies the type-checker, it doesn't change
      // runtime behavior.
      if (surveyInputs!.studentId.toString() !== user._id.toString()) {
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
