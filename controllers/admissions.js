const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { ten_minutes_cache } = require('../cache/node-cache');
const { AWS_S3_BUCKET_NAME } = require('../config');
const { getS3Object } = require('../aws/s3');
const ApplicationService = require('../services/applications');
const ApplicationQueryBuilder = require('../builders/ApplicationQueryBuilder');

const getApplicationCountsResultCount = asyncHandler(async (req) => {
  try {
    // Validate database connection
    if (!req.db) {
      throw new ErrorResponse(500, 'Database connection not available');
    }

    const result = await req.db.model('Application').aggregate([
      // Match all applications with decided = "O"
      {
        $match: {
          decided: 'O',
          programId: { $exists: true, $ne: null }
        }
      },

      // Group all applications together and count by status
      {
        $group: {
          _id: null, // Group all documents together
          admission: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$admission', 'O'] },
                    { $ne: ['$closed', '-'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          rejection: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$admission', 'X'] },
                    { $ne: ['$closed', '-'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          pending: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$admission', '-'] },
                    { $eq: ['$closed', 'O'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          notYetSubmitted: {
            $sum: {
              $cond: [{ $eq: ['$closed', '-'] }, 1, 0]
            }
          }
        }
      },

      // Project the result without _id
      {
        $project: {
          _id: 0,
          admission: 1,
          rejection: 1,
          pending: 1,
          notYetSubmitted: 1
        }
      }
    ]);

    // Return the first (and only) result, or default values if no data
    const counts =
      result.length > 0
        ? result[0]
        : {
            admission: 0,
            rejection: 0,
            pending: 0,
            notYetSubmitted: 0
          };

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

const getProgramApplicationCounts = asyncHandler(async (req) => {
  try {
    // Validate database connection
    if (!req.db) {
      throw new ErrorResponse(500, 'Database connection not available');
    }

    const result = await req.db.model('Application').aggregate([
      // Match applications with decided and closed fields set to "O"
      {
        $match: {
          decided: 'O',
          closed: 'O',
          programId: { $exists: true, $ne: null } // Ensure programId exists
        }
      },

      // Group by programId and count occurrences
      {
        $group: {
          _id: '$programId',
          applicationCount: { $sum: 1 }, // Total count of applications
          admissionCount: {
            $sum: {
              $cond: [{ $eq: ['$admission', 'O'] }, 1, 0] // Count admissions with "O"
            }
          },
          finalEnrolmentCount: {
            $sum: {
              $cond: [{ $eq: ['$finalEnrolment', true] }, 1, 0] // Count final enrolments
            }
          },
          rejectionCount: {
            $sum: {
              $cond: [{ $eq: ['$admission', 'X'] }, 1, 0] // Count rejections with "X"
            }
          },
          pendingResultCount: {
            $sum: {
              $cond: [{ $eq: ['$admission', '-'] }, 1, 0] // Count pending with "-"
            }
          }
        }
      },

      // Sort by count in descending order
      { $sort: { applicationCount: -1 } },

      // Lookup to populate program details
      {
        $lookup: {
          from: 'programs', // Ensure this matches the name of your Program collection
          localField: '_id',
          foreignField: '_id',
          as: 'programDetails'
        }
      },

      // Unwind programDetails array for easier access
      { $unwind: '$programDetails' },

      // Project only specific fields from programDetails
      {
        $project: {
          applicationCount: 1,
          admissionCount: 1,
          finalEnrolmentCount: 1,
          rejectionCount: 1,
          pendingResultCount: 1,
          id: '$programDetails._id',
          school: '$programDetails.school',
          program_name: '$programDetails.program_name',
          semester: '$programDetails.semester',
          degree: '$programDetails.degree',
          lang: '$programDetails.lang'
        }
      }
    ]);

    // Validate result
    if (!Array.isArray(result)) {
      logger.warn('Unexpected result format from aggregation pipeline');
      return [];
    }

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
    ApplicationService.getApplicationsWithStudentDetails(req, filter)
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
  const tasks = await req.db
    .model('Student')
    .find({ student_id: applications_year });
  res.status(200).send({ success: true, data: tasks });
});

module.exports = {
  getAdmissionsOverview,
  getApplicationCountsResultCount,
  getAdmissions,
  getAdmissionLetter,
  getAdmissionsYear
};
