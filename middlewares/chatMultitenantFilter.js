const { is_TaiGer_Editor, is_TaiGer_Agent } = require('@taiger-common/core');

const { ten_minutes_cache } = require('../cache/node-cache');
const { ErrorResponse } = require('../common/errors');
const logger = require('../services/logger');
const { getPermission } = require('../utils/queryFunctions');
const { asyncHandler } = require('./error-handler');
const StudentService = require('../services/students');

const chatMultitenantFilter = asyncHandler(async (req, res, next) => {
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

module.exports = {
  chatMultitenantFilter
};
