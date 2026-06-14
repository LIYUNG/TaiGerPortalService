const { Role, is_TaiGer_Agent } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { TENANT_SHORT_NAME } = require('../constants/common');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const StudentService = require('../services/students');
const UserService = require('../services/users');

const getExpenses = asyncHandler(async (req, res) => {
  const studentsWithExpenses =
    await StudentService.getTaigerUsersWithExpenses();
  res.status(200).send({ success: true, data: studentsWithExpenses });
});

const getExpense = asyncHandler(async (req, res) => {
  const { taiger_user_id } = req.params;
  const the_user = await UserService.getUserById(taiger_user_id);

  if (
    the_user.role !== Role.Admin &&
    the_user.role !== Role.Agent &&
    the_user.role !== Role.Editor
  ) {
    logger.error(`getExpense: not ${TENANT_SHORT_NAME} user!`);
    throw new ErrorResponse(401, `Invalid ${TENANT_SHORT_NAME} user`);
  }
  const studentsWithExpenses = await StudentService.getStudentsWithExpenses();
  // res.status(200).send({ success: true, data: expense });

  // query by agents field: student.agents include agent_id
  if (is_TaiGer_Agent(the_user)) {
    const students = await StudentService.getStudentsForExpenses({
      agents: the_user._id.toString(),
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    // Merge the results
    const mergedResults = students.map((student) => {
      const aggregateData = studentsWithExpenses.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });
    res
      .status(200)
      .send({ success: true, data: { students: mergedResults, the_user } });
  } else if (the_user.role === Role.Editor) {
    const students = await StudentService.getStudentsForExpenses({
      editors: the_user._id.toString(),
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    // Merge the results
    const mergedResults = students.map((student) => {
      const aggregateData = studentsWithExpenses.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });
    res
      .status(200)
      .send({ success: true, data: { students: mergedResults, the_user } });
  } else {
    res.status(200).send({ success: true, data: { students: [], the_user } });
  }
});

const syncExpense = asyncHandler(async (req, res) => {
  const users = await UserService.getUsers({});
  res.status(200).send({ success: true, data: users });
});

module.exports = {
  getExpenses,
  getExpense,
  syncExpense
};
