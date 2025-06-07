const { Role, is_TaiGer_Agent } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { TENANT_SHORT_NAME } = require('../constants/common');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');

const getExpenses = asyncHandler(async (req, res) => {
  const studentsWithExpenses = await req.db.model('Student').aggregate([
    { $match: { role: { $in: [Role.Admin, Role.Agent, Role.Editor] } } },
    {
      $lookup: {
        from: 'expenses',
        localField: '_id',
        foreignField: 'student_id',
        as: 'expenses'
      }
    }
  ]);
  res.status(200).send({ success: true, data: studentsWithExpenses });
});

const getExpense = asyncHandler(async (req, res) => {
  const { taiger_user_id } = req.params;
  const the_user = await req.db
    .model('User')
    .findById(taiger_user_id)
    .select('firstname lastname role');

  if (
    the_user.role !== Role.Admin &&
    the_user.role !== Role.Agent &&
    the_user.role !== Role.Editor
  ) {
    logger.error(`getExpense: not ${TENANT_SHORT_NAME} user!`);
    throw new ErrorResponse(401, `Invalid ${TENANT_SHORT_NAME} user`);
  }
  const studentsWithExpenses = await req.db.model('Student').aggregate([
    {
      $lookup: {
        from: 'expenses',
        localField: '_id',
        foreignField: 'student_id',
        as: 'expenses'
      }
    }
  ]);
  // res.status(200).send({ success: true, data: expense });

  // query by agents field: student.agents include agent_id
  if (is_TaiGer_Agent(the_user)) {
    const students = await req.db
      .model('Student')
      .find({
        agents: the_user._id.toString(),
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .populate('agents editors', 'firstname lastname email')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .select('-notification')
      .lean();
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
    const students = await req.db
      .model('Student')
      .find({
        editors: the_user._id.toString(),
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .populate('agents editors', 'firstname lastname email')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .select('-notification')
      .lean();
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
  const users = await req.db.model('User').find();
  res.status(200).send({ success: true, data: users });
});

module.exports = {
  getExpenses,
  getExpense,
  syncExpense
};
