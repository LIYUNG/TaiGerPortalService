const path = require('path');
const async = require('async');
const { Role } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');

const getApplicationConflicts = asyncHandler(async (req, res) => {
  const applicationConflicts = await req.db.model('Student').aggregate([
    {
      $match: {
        archiv: {
          $ne: true
        }
      }
    },
    {
      $unwind: {
        path: '$applications'
      }
    },
    {
      $match: {
        'applications.decided': 'O'
      }
    },
    {
      $group: {
        _id: '$applications.programId',
        students: {
          $addToSet: {
            studentId: '$_id',
            firstname: '$firstname',
            lastname: '$lastname',
            application_preference: '$application_preference'
          }
        },
        count: {
          $sum: 1
        }
      }
    },
    {
      $match: {
        count: {
          $gt: 1
        }
      }
    },
    {
      $sort: {
        count: -1
      }
    },
    {
      $lookup: {
        from: 'programs',
        localField: '_id',
        foreignField: '_id',
        as: 'program'
      }
    },
    {
      $unwind: {
        path: '$program'
      }
    }
  ]);

  res.status(200).send({ success: true, data: applicationConflicts });
});

module.exports = {
  getApplicationConflicts
};
