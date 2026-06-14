const { ten_minutes_cache } = require('../cache/node-cache');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const PermissionService = require('../services/permissions');
const StudentService = require('../services/students');

// These function will cache frequently query result but not change frequently.

const getPermission = asyncHandler(async (req, user) => {
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

const getCachedStudentPermission = async (req, studentId) => {
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

module.exports = {
  getPermission,
  getCachedStudentPermission
};
