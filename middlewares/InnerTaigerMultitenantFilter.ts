const { is_TaiGer_Editor, is_TaiGer_Agent } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const {
  getPermission,
  getCachedStudentPermission
} = require('../utils/queryFunctions');
const { asyncHandler } = require('./error-handler');

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

module.exports = {
  InnerTaigerMultitenantFilter
};
