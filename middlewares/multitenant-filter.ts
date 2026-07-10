import { Role, is_TaiGer_Student, is_TaiGer_Guest } from '@taiger-common/core';
import { NextFunction, Request, Response } from 'express';
import type { IUser } from '@taiger-common/model';
import type { Types } from 'mongoose';

import { ErrorResponse } from '../common/errors';
import ComplaintService from '../services/complaints';

// Populated by the `protect` auth middleware before this filter runs, so it is
// always present at this point despite `Request.user` being declared optional.
type AuthUser = IUser & { _id: Types.ObjectId | string };

export const multitenant_filter = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const {
    params: { studentId, user_id }
  } = req;
  const user = req.user as AuthUser;
  if (user.role === Role.Student || user.role === Role.Guest) {
    if (
      (studentId && user._id.toString() !== studentId) ||
      (user_id && user._id.toString() !== user_id)
    ) {
      return next(
        new ErrorResponse(403, 'Not allowed to access other resource.')
      );
    }
  }
  next();
};

export const complaintTicketMultitenant_filter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const {
    params: { ticketId }
  } = req;
  const user = req.user as AuthUser;
  if (is_TaiGer_Student(user) || is_TaiGer_Guest(user)) {
    const ticket = await ComplaintService.getComplaintDocById(String(ticketId));
    if (
      ticket.requester_id.toString() &&
      user._id.toString() !== ticket.requester_id.toString()
    ) {
      return next(
        new ErrorResponse(403, 'Not allowed to access other resource.')
      );
    }
  }
  next();
};
