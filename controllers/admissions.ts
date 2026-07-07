import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import { AWS_S3_BUCKET_NAME } from '../config';
import { getS3Object } from '../aws/s3';
import ApplicationService from '../services/applications';
import StudentService from '../services/students';

const getAdmissionsOverview = asyncHandler(async (req, res) => {
  const counts = await ApplicationService.getAdmissionsStatusCounts();
  res.status(200).send({ success: true, data: counts });
});

// Per-program application counts, powering the admissions "Program" stat tab.
// (The paginated applications list is served by the applications endpoint.)
const getAdmissionsProgramCounts = asyncHandler(async (req, res, _next) => {
  const result = await ApplicationService.getProgramApplicationCounts();

  res.status(200).send({
    success: true,
    result: result || []
  });
});

const getAdmissionLetter = asyncHandler(async (req, res, _next) => {
  const {
    params: { studentId, fileName }
  } = req;

  // AWS S3
  // download the file via aws s3 here
  const fileKey = `${studentId}/admission/${fileName}`;
  logger.info(`Trying to download admission letter: ${fileKey}`);
  const encodedFileName = encodeURIComponent(fileName);
  const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);

  res.attachment(encodedFileName);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodedFileName}`
  );
  res.end(response);
});

const getAdmissionsYear = asyncHandler(async (req, res) => {
  const { applications_year } = req.params;
  const tasks = await StudentService.findStudents({
    student_id: applications_year
  });
  res.status(200).send({ success: true, data: tasks });
});

export = {
  getAdmissionsOverview,
  getAdmissionsProgramCounts,
  getAdmissionLetter,
  getAdmissionsYear
};
