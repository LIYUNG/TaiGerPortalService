import { is_TaiGer_Editor, is_TaiGer_Agent } from '@taiger-common/core';

import { ErrorResponse } from '../common/errors';
import {
  getPermission,
  getCachedStudentPermission
} from '../utils/queryFunctions';
import { asyncHandler } from './error-handler';

const InnerTaigerMultitenantFilter = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;
  if (is_TaiGer_Editor(user) || is_TaiGer_Agent(user)) {
    const permissions = await getPermission(req, user);

    const student = await getCachedStudentPermission(req, studentId);
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
});

export = {
  InnerTaigerMultitenantFilter
};
