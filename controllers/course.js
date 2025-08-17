const _ = require('lodash');
const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const { is_TaiGer_Student, is_TaiGer_Guest } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const {
  updateCoursesDataAgentEmail,
  AnalysedCoursesDataStudentEmail
} = require('../services/email');
const { one_month_cache } = require('../cache/node-cache');
const { AWS_S3_BUCKET_NAME, isProd } = require('../config');
const { isNotArchiv } = require('../constants');
const { getTemporaryCredentials, callApiGateway } = require('../aws');
const { getS3Object, uploadJsonToS3 } = require('../aws/s3');
const {
  roleToAssumeForCourseAnalyzerAPIG,
  apiGatewayUrl
} = require('../aws/constants');

const getMycourses = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const student = await req.db.model('Student').findById(studentId);
  if (!student) {
    logger.info('getMycourses: no student found');
    throw new ErrorResponse(500, 'Invalid student');
  }
  const courses = await req.db
    .model('Course')
    .findOne({
      student_id: studentId
    })
    .populate(
      'student_id',
      'firstname lastname agents editors archiv pictureUrl'
    );

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

// TODO: deprecated
const processTranscript_test = asyncHandler(async (req, res, next) => {
  const {
    params: { category, studentId, language }
  } = req;
  const courses = await req.db
    .model('Course')
    .findOne({ student_id: studentId })
    .populate('student_id');
  if (!courses) {
    logger.error('no course for this student!');
    return res.send({ success: true, data: {} });
  }
  const stringified_courses = JSON.stringify(courses.table_data_string);
  const stringified_courses_taiger_guided = JSON.stringify(
    courses.table_data_string_taiger_guided
  );

  let exitCode_Python = -1;
  // TODO: multitenancy studentId?
  let student_name = `${courses.student_id.firstname}_${courses.student_id.lastname}`;
  student_name = student_name.replace(/ /g, '-');
  const python_command = isProd() ? 'python3' : 'python';
  const python = spawn(
    python_command,
    [
      path.join(
        __dirname,
        '..',
        'python',
        'TaiGerTranscriptAnalyzerJS',
        'main.py'
      ),
      stringified_courses,
      category,
      studentId,
      student_name,
      language,
      stringified_courses_taiger_guided
    ],
    { stdio: 'inherit' }
  );
  python.on('data', (data) => {
    logger.info(`${data}`);
  });
  python.on('error', (err) => {
    logger.error('error');
    logger.error(err);
    exitCode_Python = err;
  });

  python.on('close', (code) => {
    if (code === 0) {
      courses.analysis.isAnalysed = true;
      courses.analysis.path = path.join(
        studentId,
        `analysed_transcript_${student_name}.xlsx`
      );
      courses.analysis.updatedAt = new Date();
      courses.save();

      const url_split = req.originalUrl.split('/');
      const cache_key = `${url_split[1]}/${url_split[2]}/${url_split[3]}/${url_split[4]}`;
      const success = one_month_cache.del(cache_key);
      if (success === 1) {
        logger.info('cache key deleted successfully');
      }
      exitCode_Python = 0;
      res.status(200).send({ success: true, data: courses.analysis });
      // TODO: send analysed link email to student
    } else {
      res.status(403).send({ message: code });
    }
  });

  // TODO: information student
  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('agents', 'firstname lastname email pictureUrl')
    .lean();

  if (isNotArchiv(student)) {
    await AnalysedCoursesDataStudentEmail(
      {
        firstname: student.firstname,
        lastname: student.lastname,
        address: student.email
      },
      {
        student_id: studentId
      }
    );
  }
  next();
});

// TODO: deprecated
const processTranscript_api = asyncHandler(async (req, res, next) => {
  const {
    params: { category, studentId, language }
  } = req;
  const courses = await req.db
    .model('Course')
    .findOne({ student_id: studentId })
    .populate('student_id');
  if (!courses) {
    logger.error('no course for this student!');
    return res.send({ success: true, data: {} });
  }
  const stringified_courses = JSON.stringify(courses.table_data_string);
  const stringified_courses_taiger_guided = JSON.stringify(
    courses.table_data_string_taiger_guided
  );

  // TODO: multitenancy studentId?
  let student_name = `${courses.student_id.firstname}_${courses.student_id.lastname}`;
  student_name = student_name.replace(/ /g, '-');
  try {
    const result = await axios.post(
      'http://127.0.0.1:8000/analyze-transcript',
      {
        courses: stringified_courses,
        category: category,
        student_id: studentId,
        student_name: student_name,
        language: language,
        courses_taiger_guided: stringified_courses_taiger_guided
      }
    );
    courses.analysis.isAnalysed = true;
    courses.analysis.path = path.join(
      studentId,
      `analysed_transcript_${student_name}.xlsx`
    );
    courses.analysis.updatedAt = new Date();
    courses.save();

    const url_split = req.originalUrl.split('/');

    // temporary workaround before full migration
    // const cache_key = `${url_split[1]}/${url_split[2]}/${url_split[3]}/${url_split[4]}`;
    const cache_key = `${url_split[1]}/${url_split[2]}/transcript/${url_split[4]}`;

    const success = one_month_cache.del(cache_key);
    if (success === 1) {
      logger.info('cache key deleted successfully');
    }
    res.status(200).send({ success: true, data: courses.analysis });
    // TODO: send analysed link email to student
  } catch (err) {
    logger.info(err);
    res.status(403).send({ message: 'analyze failed' });
  }

  // TODO: information student
  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('agents', 'firstname lastname email pictureUrl')
    .lean();

  if (isNotArchiv(student)) {
    await AnalysedCoursesDataStudentEmail(
      {
        firstname: student.firstname,
        lastname: student.lastname,
        address: student.email
      },
      {
        student_id: studentId
      }
    );
  }
  next();
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

    const courses = await req.db
      .model('Course')
      .findOne({ student_id: studentId })
      .populate('student_id');
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

    courses.analysis.isAnalysedV2 = true;
    courses.analysis.pathV2 = path.join(
      studentId,
      `analysed_transcript_${student_name}.json`
    );
    courses.analysis.updatedAtV2 = new Date();
    courses.save();

    const cacheKey = `analysed_transcript_${studentId}.json`;

    const success = one_month_cache.del(cacheKey);
    if (success === 1) {
      logger.info('cache key deleted successfully');
    }

    res.status(200).send({ success: true, data: courses.analysis });
  } catch (err) {
    logger.info(err);
    throw new ErrorResponse(500, 'Error occurs while analyzing courses');
  }

  next();
});

// TODO: deprecate. Download original transcript excel
const downloadXLSX = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;

  const studentIdToUse =
    is_TaiGer_Student(user) || is_TaiGer_Guest(user) ? user._id : studentId;
  const course = await req.db.model('Course').findOne({
    student_id: studentIdToUse.toString()
  });
  if (!course) {
    logger.error('downloadXLSX: Invalid student id');
    throw new ErrorResponse(404, 'Course not found');
  }

  if (!course.analysis.isAnalysed || !course.analysis.path) {
    logger.error('downloadXLSX: not analysed yet');
    throw new ErrorResponse(403, 'Transcript not analysed yet');
  }

  const fileKey = course.analysis.path.replace(/\\/g, '/');

  logger.info(`Trying to download transcript excel file ${fileKey}`);

  const url_split = req.originalUrl.split('/');
  // const cache_key = `${url_split[1]}/${url_split[2]}/${url_split[3]}/${url_split[4]}`;
  // const value = one_month_cache.get(cache_key);
  // if (value === undefined) {
  const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
  // Convert Body from a Buffer to a String
  const fileKey_converted = encodeURIComponent(fileKey); // Use the encoding necessary

  // const success = one_month_cache.set(cache_key, Buffer.from(response));
  // if (success) {
  //   logger.info('cache set successfully');
  // }

  res.attachment(fileKey_converted);
  res.end(response);
  next();
  // } else {
  //   logger.info('cache hit');
  //   const fileKey_converted = encodeURIComponent(fileKey); // Use the encoding necessary
  //   res.attachment(fileKey_converted);
  //   res.end(value);
  //   next();
  // }
});

const downloadJson = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId }
  } = req;

  const course = await req.db
    .model('Course')
    .findOne({
      student_id: studentId
    })
    .populate(
      'student_id',
      'firstname lastname firstname_chinese lastname_chinese role academic_background application_preference pictureUrl'
    );
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
  const cacheKey = `analysed_transcript_${studentId}.json`;

  const value = one_month_cache.get(cacheKey);
  if (value === undefined) {
    const analysedJson = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const jsonString = Buffer.from(analysedJson).toString('utf-8');
    const jsonData = JSON.parse(jsonString);
    const fileKey_converted = encodeURIComponent(fileKey); // Use the encoding necessary
    const success = one_month_cache.set(fileKey, {
      jsonData,
      fileKey_converted
    });
    if (success) {
      logger.info(
        `Course analysis json cache set successfully: key ${cacheKey}`
      );
    }

    res.status(200).send({
      success: true,
      json: jsonData,
      student: course.student_id,
      fileKey: fileKey_converted
    });
    next();
  } else {
    logger.info('cache hit');
    logger.info(`Course analysis json cache hit ${cacheKey}`);
    res.status(200).send({
      success: true,
      json: value.jsonData,
      student: course.student_id,
      fileKey: value.fileKey_converted
    });
    next();
  }
});

const deleteMyCourse = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const course = await req.db
    .model('Course')
    .findOne({ student_id: studentId });
  if (!course) {
    return res.status(404).send({ error: 'Course not found' });
  }
  try {
    await req.db.model('Course').findOneAndDelete({ student_id: studentId });
    return res.send({ success: true });
  } catch (e) {
    logger.info(`deleteMyCourse: ${e}`);
    throw new ErrorResponse(500, 'deleteMyCourse Internal error');
  }
});

module.exports = {
  getMycourses,
  putMycourses,
  processTranscript_test,
  processTranscript_api,
  processTranscript_api_gatway,
  downloadXLSX,
  downloadJson,
  deleteMyCourse
};
