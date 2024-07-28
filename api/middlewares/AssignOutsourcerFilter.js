const { ErrorResponse } = require('../common/errors');
const { Role } = require('../models/User');
const { getPermission } = require('../utils/queryFunctions');
const { asyncHandler } = require('./error-handler');

// Editor Lead, student's agents and agent lead
// TODO: test case
const AssignOutsourcerFilter = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { messagesThreadId }
  } = req;
  if (user.role === Role.Editor || user.role === Role.Agent) {
    const permissions = await getPermission(user);
    let outsourcer_allowed_modify = false;
    let studentId_temp = '';
    const document_thread = await req.db
      .model('Documentthread')
      .findById(messagesThreadId)
      .populate('student_id')
      .lean();
    studentId_temp = document_thread.student_id._id.toString();
    outsourcer_allowed_modify =
      document_thread.outsourced_user_id?.some(
        (outsourcer_id) => outsourcer_id.toString() === user._id.toString()
      ) ||
      (document_thread.file_type !== 'Essay' &&
        document_thread.student_id?.agents?.some(
          (agent) => agent?.toString() === user._id.toString()
        ));

    const student = await req.db
      .model('Student')
      .findById(studentId_temp)
      .select('agents editors');
    if (!student) {
      throw new ErrorResponse(
        403,
        'Permission denied: Not allowed to access other students documents. Please contact administrator.'
      );
    }
    if (
      [...student.agents, ...student.editors].some(
        (taiger_user) => taiger_user.toString() === user._id.toString()
      ) ||
      permissions?.canAssignEditors ||
      permissions?.canAssignAgents ||
      outsourcer_allowed_modify
    ) {
      next();
    }

    throw new ErrorResponse(
      403,
      'Permission denied: Not allowed to access other students documents. Please contact administrator.'
    );
  }
  next();
});

module.exports = {
  AssignOutsourcerFilter
};
