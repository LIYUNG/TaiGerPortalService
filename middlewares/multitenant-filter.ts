import { Role, is_TaiGer_Student, is_TaiGer_Guest } from '@taiger-common/core';

import { ErrorResponse } from '../common/errors';
import ComplaintService from '../services/complaints';

const multitenant_filter = (req, res, next) => {
  const {
    user,
    params: { studentId, user_id }
  } = req;
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

const complaintTicketMultitenant_filter = async (req, res, next) => {
  const {
    user,
    params: { ticketId }
  } = req;
  if (is_TaiGer_Student(user) || is_TaiGer_Guest(user)) {
    const ticket = await ComplaintService.getComplaintDocById(ticketId);
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

module.exports = {
  multitenant_filter,
  complaintTicketMultitenant_filter
};
