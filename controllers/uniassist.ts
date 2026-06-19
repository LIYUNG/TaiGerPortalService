import { is_TaiGer_Student } from '@taiger-common/core';
import { asyncHandler } from '../middlewares/error-handler';
import StudentService from '../services/students';
import ApplicationService from '../services/applications';

const getStudentUniAssist = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId }
  } = req;
  if (is_TaiGer_Student(user)) {
    const obj = user.notification; // create object
    obj['isRead_uni_assist_task_assigned'] = true; // set value
    await StudentService.updateStudentById(user._id.toString(), {
      notification: obj
    });
  }

  const student: any = await StudentService.getStudentById(studentId);
  const applications = await ApplicationService.getApplicationsByStudentId(
    studentId
  );
  student.applications = applications;
  if (is_TaiGer_Student(user)) {
    delete student.attributes;
  }
  res.status(200).send({ success: true, data: student });
});

export = {
  getStudentUniAssist
};
