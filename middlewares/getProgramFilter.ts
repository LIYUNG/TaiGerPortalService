import { NextFunction, Request, Response } from 'express';
import { is_TaiGer_Student } from '@taiger-common/core';
import type { IUser } from '@taiger-common/model';
import type { Types } from 'mongoose';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import ApplicationService from '../services/applications';

// Populated by the `protect` auth middleware before this filter runs, so it is
// always present at this point despite `Request.user` being declared optional.
type AuthUser = IUser & { _id: Types.ObjectId | string };

const getProgramFilter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = req.user as AuthUser;
  const { programId } = req.params;
  if (is_TaiGer_Student(user)) {
    const myApplications = await ApplicationService.getApplications({
      programId,
      studentId: user._id
    });
    if (
      myApplications.findIndex(
        (app) => app.programId._id.toString() === programId
      ) === -1
    ) {
      logger.error('getProgram: Invalid program id in your applications');
      return res
        .status(403)
        .json(
          new ErrorResponse(403, 'Invalid program id in your applications')
        );
    }
  }
  next();
};

export = getProgramFilter;
