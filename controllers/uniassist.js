const path = require('path');
const { is_TaiGer_Student } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');

const getStudentUniAssist = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId }
  } = req;
  if (is_TaiGer_Student(user)) {
    const obj = user.notification; // create object
    obj['isRead_uni_assist_task_assigned'] = true; // set value
    await req.db
      .model('Student')
      .findByIdAndUpdate(user._id.toString(), { notification: obj }, {});
  }

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('agents editors', 'firstname lastname email')
    .populate('applications.programId')
    .populate(
      'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
      '-messages'
    )
    .select('-attributes')
    .lean();
  res.status(200).send({ success: true, data: student });
});

module.exports = {
  getStudentUniAssist
};
