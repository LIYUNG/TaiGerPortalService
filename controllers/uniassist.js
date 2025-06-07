const { is_TaiGer_Student } = require('@taiger-common/core');
const { asyncHandler } = require('../middlewares/error-handler');
const StudentService = require('../services/students');
const ApplicationService = require('../services/applications');

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

  const student = await StudentService.getStudentById(req, studentId);
  const applications = await ApplicationService.getApplicationsByStudentId(
    req,
    studentId
  );
  student.applications = applications;
  if (is_TaiGer_Student(user)) {
    delete student.attributes;
  }
  res.status(200).send({ success: true, data: student });
});

module.exports = {
  getStudentUniAssist
};
