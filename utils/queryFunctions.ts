import type { Request } from 'express';
import { ten_minutes_cache } from '../cache/node-cache';
import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import PermissionService from '../services/permissions';
import StudentService from '../services/students';

// These function will cache frequently query result but not change frequently.

export const getPermission = asyncHandler(async (req, user) => {
  let cachedPermission = ten_minutes_cache.get(
    `/permission/${user._id.toString()}`
  );
  if (cachedPermission === undefined) {
    const permissions = await PermissionService.getPermissionByUserId(user._id);

    const success = ten_minutes_cache.set(
      `/permission/${user._id.toString()}`,
      permissions
    );
    if (success) {
      cachedPermission = permissions;
      logger.info(
        `permissions cache set successfully: user id ${user._id.toString()}`
      );
    }
  }
  return cachedPermission;
});

export const getCachedStudentPermission = async (
  req: Request,
  studentId: string
) => {
  let cachedStudent = ten_minutes_cache.get(`/filter/studentId/${studentId}`);
  if (cachedStudent === undefined) {
    const student = await StudentService.getStudentByIdSelect(
      studentId,
      'agents editors'
    );

    const success = ten_minutes_cache.set(
      `/filter/studentId/${studentId}`,
      student
    );
    if (success) {
      cachedStudent = student;
      logger.info('student cache set successfully');
    }
  }
  return cachedStudent;
};
