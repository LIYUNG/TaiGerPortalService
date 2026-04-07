const _ = require('lodash');
const path = require('path');
const { is_TaiGer_Student } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const {
  updateCoursesDataAgentEmail,
  AnalysedCoursesDataStudentEmail
} = require('../services/email');
const { AWS_S3_BUCKET_NAME } = require('../config');
const { isNotArchiv } = require('../constants');
const { getTemporaryCredentials, callApiGateway } = require('../aws');
const { getS3Object, uploadJsonToS3 } = require('../aws/s3');
const {
  roleToAssumeForCourseAnalyzerAPIG,
  apiGatewayUrl
} = require('../aws/constants');
const CourseService = require('../services/course');

const getMycourses = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const student = await req.db.model('Student').findById(studentId);
  if (!student) {
    logger.info('getMycourses: no student found');
    throw new ErrorResponse(500, 'Invalid student');
  }
  const courses = await CourseService.getCourse(req, {
    student_id: studentId
  });

  if (!courses) {
    return res.send({
      success: true,
      data: {
        student_id: {
          _id: student._id,
          firstname: student.firstname,
          lastname: student.lastname,
          agents: student.agents,
          editors: student.editors,
          archiv: student.archiv
        },
        table_data_string_locked: false,
        table_data_string:
          '[{"course_chinese":"(Example)物理一","course_english":null,"credits":"2","grades":"73"},{"course_chinese":"(Example)微積分一","course_english":null,"credits":"2","grades":"77"},{"course_chinese":"(Example)微積分二","course_english":null,"credits":"3","grades":"88"}]',
        table_data_string_taiger_guided:
          '[{"course_chinese":"","course_english":"","credits":"0","grades":""}]'
      }
    });
  }
  return res.send({ success: true, data: courses });
});

const putMycourses = asyncHandler(async (req, res) => {
  const { user } = req;
  const { studentId } = req.params;
  const fields = req.body;
  fields.updatedAt = new Date();

  if (is_TaiGer_Student(user)) {
    delete fields.table_data_string_locked;
  }

  const courses2 = await req.db
    .model('Course')
    .findOneAndUpdate({ student_id: studentId }, fields, {
      upsert: true,
      new: false
    })
    .populate('student_id', 'firstname lastname pictureUrl');
  res.send({ success: true, data: courses2 });
  if (is_TaiGer_Student(user)) {
    // TODO: send course update to Agent
    const student = await req.db
      .model('Student')
      .findById(studentId)
      .populate('agents', 'firstname lastname email pictureUrl')
      .lean();

    for (let i = 0; i < student.agents.length; i += 1) {
      if (isNotArchiv(student)) {
        updateCoursesDataAgentEmail(
          {
            firstname: student.agents[i].firstname,
            lastname: student.agents[i].lastname,
            address: student.agents[i].email
          },
          {
            student_id: studentId,
            student_firstname: courses2.student_id.firstname,
            student_lastname: courses2.student_id.lastname
          }
        );
      }
    }
  }
});

const processTranscript_api_gatway = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, language },
    body: { requirementIds, factor }
  } = req;

  try {
    const { Credentials } = await getTemporaryCredentials(
      roleToAssumeForCourseAnalyzerAPIG
    );

    const courses = await CourseService.getCourse(req, {
      student_id: studentId
    });

    if (!courses) {
      logger.error('no course for this student!');
      return res.send({ success: true, data: {} });
    }
    const stringified_courses = JSON.stringify(courses.table_data_string);
    const stringified_courses_taiger_guided = JSON.stringify(
      courses.table_data_string_taiger_guided
    );

    let student_name = `${courses.student_id.firstname}_${courses.student_id.lastname}`;
    student_name = student_name.replace(/ /g, '-');
    const response = await callApiGateway(Credentials, apiGatewayUrl, 'POST', {
      courses: stringified_courses,
      student_id: studentId,
      student_name,
      factor: factor || 1.5,
      language,
      courses_taiger_guided: stringified_courses_taiger_guided,
      requirement_ids: JSON.stringify(requirementIds)
    });
    console.log(response);
    // TODO: update json to S3
    await uploadJsonToS3(
      response.result,
      AWS_S3_BUCKET_NAME,
      `${studentId}/analysed_transcript_${student_name}.json`
    );

    await CourseService.updateCourse(
      req,
      { student_id: studentId },
      {
        analysis: {
          isAnalysedV2: true,
          pathV2: path.join(
            studentId,
            `analysed_transcript_${student_name}.json`
          ),
          updatedAtV2: new Date()
        }
      }
    );

    res.status(200).send({ success: true, data: courses.analysis });
  } catch (err) {
    logger.info(err);
    throw new ErrorResponse(500, 'Error occurs while analyzing courses');
  }

  next();
});

const downloadJson = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId }
  } = req;

  const course = await CourseService.getCourse(req, {
    student_id: studentId
  });

  if (!course) {
    logger.error('downloadJson: Invalid student id');
    throw new ErrorResponse(404, 'Course not found');
  }

  if (!course.analysis.isAnalysedV2 || !course.analysis.pathV2) {
    logger.error('downloadJson: not analysed yet');
    throw new ErrorResponse(403, 'Transcript not analysed yet');
  }

  const fileKey = course.analysis.pathV2.replace(/\\/g, '/');
  logger.info(`Trying to download transcript excel file ${fileKey}`);

  const analysedJson = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
  const jsonString = Buffer.from(analysedJson).toString('utf-8');
  const jsonData = JSON.parse(jsonString);
  const fileKey_converted = encodeURIComponent(fileKey); // Use the encoding necessary

  res.status(200).send({
    success: true,
    json: jsonData,
    student: course.student_id,
    fileKey: fileKey_converted
  });
  next();
});

const deleteMyCourse = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const course = await CourseService.getCourse(req, {
    student_id: studentId
  });
  if (!course) {
    logger.error('deleteMyCourse: Course not found');
    throw new ErrorResponse(404, 'Course not found');
  }
  await CourseService.deleteCourse(req, { student_id: studentId });
  res.status(200).send({ success: true });
});

module.exports = {
  getMycourses,
  putMycourses,
  processTranscript_api_gatway,
  downloadJson,
  deleteMyCourse
};
