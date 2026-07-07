import type { Request } from 'express';
import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import { AWS_S3_BUCKET_NAME } from '../config';
import { getS3Object } from '../aws/s3';
import ApplicationService from '../services/applications';
import StudentService from '../services/students';

// Overall admission/rejection/pending/notYetSubmitted counts.
const getApplicationCountsResultCount = async (_req?: Request) => {
  try {
    const counts = await ApplicationService.getAdmissionsStatusCounts();
    logger.info('Successfully fetched application counts:', counts);
    return counts;
  } catch (error) {
    logger.error(
      'Error fetching application counts:',
      error as Record<string, unknown>
    );
    if (error instanceof ErrorResponse) {
      throw error;
    }
    throw new ErrorResponse(500, 'Error fetching application counts');
  }
};

const getProgramApplicationCounts = async (_req?: Request) => {
  try {
    const result = await ApplicationService.getProgramApplicationCounts();
    logger.info(
      `Successfully fetched application counts for ${result.length} programs`
    );
    return result;
  } catch (error) {
    logger.error(
      'Error fetching program application counts:',
      error as Record<string, unknown>
    );
    if (error instanceof ErrorResponse) {
      throw error;
    }
    throw new ErrorResponse(500, 'Error fetching program application counts');
  }
};

const getAdmissionsOverview = asyncHandler(async (req, res) => {
  const result = await getApplicationCountsResultCount(req);
  res.status(200).send({ success: true, data: result });
});

const getAdmissions = asyncHandler(async (req, res, _next) => {
  const [result] = await Promise.all([getProgramApplicationCounts(req)]);

  res.status(200).send({
    success: true,
    data: [],
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
  getApplicationCountsResultCount,
  getAdmissions,
  getAdmissionLetter,
  getAdmissionsYear
};
