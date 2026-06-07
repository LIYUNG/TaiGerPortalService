const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { AWS_S3_BUCKET_NAME } = require('../config');
const { getS3Object } = require('../aws/s3');
const ApplicationService = require('../services/applications');
const StudentService = require('../services/students');
const ApplicationQueryBuilder = require('../builders/ApplicationQueryBuilder');

// Overall admission/rejection/pending/notYetSubmitted counts.
const getApplicationCountsResultCount = asyncHandler(async () => {
  try {
    const counts = await ApplicationService.getAdmissionsStatusCounts();
    logger.info('Successfully fetched application counts:', counts);
    return counts;
  } catch (error) {
    logger.error('Error fetching application counts:', error);
    if (error instanceof ErrorResponse) {
      throw error;
    }
    throw new ErrorResponse(500, 'Error fetching application counts');
  }
});

const getProgramApplicationCounts = asyncHandler(async () => {
  try {
    const result = await ApplicationService.getProgramApplicationCounts();
    logger.info(
      `Successfully fetched application counts for ${result.length} programs`
    );
    return result;
  } catch (error) {
    logger.error('Error fetching program application counts:', error);
    if (error instanceof ErrorResponse) {
      throw error;
    }
    throw new ErrorResponse(500, 'Error fetching program application counts');
  }
});

const getAdmissionsOverview = asyncHandler(async (req, res) => {
  const result = await getApplicationCountsResultCount(req);
  res.status(200).send({ success: true, data: result });
});

const getAdmissions = asyncHandler(async (req, res, next) => {
  const { decided, closed, admission } = req.query;
  const { filter } = new ApplicationQueryBuilder()
    .withDecided(decided)
    .withClosed(closed)
    .withAdmission(admission)
    .build();

  const [result, applications] = await Promise.all([
    getProgramApplicationCounts(req),
    ApplicationService.getApplicationsWithStudentDetails(filter)
  ]);

  res.status(200).send({
    success: true,
    data: applications || [],
    result: result || []
  });
});

const getAdmissionLetter = asyncHandler(async (req, res, next) => {
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

module.exports = {
  getAdmissionsOverview,
  getApplicationCountsResultCount,
  getAdmissions,
  getAdmissionLetter,
  getAdmissionsYear
};
