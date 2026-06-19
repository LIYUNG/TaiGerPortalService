import { is_TaiGer_Editor, is_TaiGer_Agent } from '@taiger-common/core';

import { ten_minutes_cache } from '../cache/node-cache';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import { getPermission } from '../utils/queryFunctions';
import { asyncHandler } from './error-handler';
import StudentService from '../services/students';

export const chatMultitenantFilter = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;
  if (is_TaiGer_Editor(user) || is_TaiGer_Agent(user)) {
    let cachedStudent = ten_minutes_cache.get(
      `/chatMultitenantFilter/students/${studentId}`
    );
    if (cachedStudent === undefined) {
      const student = await StudentService.getStudentByIdSelect(
        studentId,
        'agents editors'
      );

      const success = ten_minutes_cache.set(
        `/chatMultitenantFilter/students/${studentId}`,
        student
      );
      if (success) {
        cachedStudent = student;
        logger.info('students agents editos cache set successfully');
      }
    }

    const cachedPermission = await getPermission(req, user);

    if (
      !cachedStudent.agents?.some(
        (agent_id) => agent_id.toString() === user._id.toString()
      ) &&
      !cachedStudent.editors?.some(
        (editor_id) => editor_id.toString() === user._id.toString()
      ) &&
      !cachedPermission?.canAccessAllChat
    ) {
      return next(
        new ErrorResponse(403, 'Not allowed to access other students.')
      );
    }
  }
  next();
});
