import { is_TaiGer_Editor, is_TaiGer_Agent } from '@taiger-common/core';
import { NextFunction, Request, Response } from 'express';
import type { IUser, IPermission, IAgent, IEditor } from '@taiger-common/model';
import type { Types } from 'mongoose';
import { ErrorResponse } from '../common/errors';
import {
  getPermission,
  getCachedStudentPermission
} from '../utils/queryFunctions';
import { asyncHandler } from './error-handler';

// Populated by the `protect` auth middleware before this filter runs, so it is
// always present at this point despite `Request.user` being declared optional.
type AuthUser = IUser & { _id: Types.ObjectId | string };

// `getCachedStudentPermission` proxies a node-cache lookup (typed `unknown`
// upstream) whose real payload is either a not-found sentinel (`{ length: 0 }`,
// see the unit tests) or the pair of ownership arrays read below.
type StudentAccessInfo = {
  length?: number;
  agents: (IAgent | Types.ObjectId | string)[];
  editors: (IEditor | Types.ObjectId | string)[];
};

export const InnerTaigerMultitenantFilter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      params: { studentId }
    } = req;
    const user = req.user as AuthUser;
    if (is_TaiGer_Editor(user) || is_TaiGer_Agent(user)) {
      const permissions = (await getPermission(req, user)) as
        | IPermission
        | undefined;

      const student = (await getCachedStudentPermission(
        req,
        String(studentId)
      )) as StudentAccessInfo;
      if (student.length === 0) {
        next(new ErrorResponse(404, 'Student not found'));
      } else if (
        ![...student.agents, ...student.editors].some(
          (taiger_user) => taiger_user.toString() === user._id.toString()
        ) &&
        !permissions?.canModifyAllBaseDocuments
      ) {
        next(
          new ErrorResponse(
            403,
            'Permission denied: Not allowed to access other students documents. Please contact administrator.'
          )
        );
      }
    }
    next();
  }
);
