const mongoose = require('mongoose');

/**
 * StudentService handles queries for the Student model.
 */
const StudentService = {
  /**
   * Fetches a student by ID with optional population.
   *
   * @param {mongoose.Connection} db - The Mongoose connection instance.
   * @param {string} filter - The query filter.
   * @returns {Promise<mongoose.Document | null>} - The student document.
   */
  async fetchStudents(req, filter = {}, options = {}) {
    return req.db
      .model('Student')
      .find(filter)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .select('-notification')
      .select('-notification')
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean();
  },
  async fetchSimpleStudents(req, filter) {
    return req.db
      .model('Student')
      .find(filter)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .select('-notification')
      .lean();
  },
  async getStudents(req, { filter = {}, options = {} }) {
    return req.db
      .model('User')
      .find(filter)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean();
  },
  async getStudentById(req, id) {
    return req.db
      .model('Student')
      .findById(id)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .lean();
  },
  async updateStudentById(req, id, update) {
    return req.db
      .model('Student')
      .findByIdAndUpdate(id, update, { new: true })
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .lean();
  },
  async getStudentsWithApplications(req, filter) {
    const students = await req.db.model('Student').aggregate([
      {
        $match: filter
      },
      {
        $lookup: {
          from: 'applications',
          localField: '_id',
          foreignField: 'studentId',
          as: 'applications'
        }
      },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'courses'
        }
      },
      {
        $addFields: {
          courses: { $arrayElemAt: ['$courses', 0] }
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { agentIds: '$agents' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$agentIds'] }
              }
            },
            {
              $project: {
                firstname: 1,
                lastname: 1,
                email: 1,
                archiv: 1
              }
            }
          ],
          as: 'agents'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { editorIds: '$editors' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$editorIds'] }
              }
            },
            {
              $project: {
                firstname: 1,
                lastname: 1,
                email: 1,
                archiv: 1
              }
            }
          ],
          as: 'editors'
        }
      },
      {
        $unwind: {
          path: '$generaldocs_threads',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'documentthreads',
          localField: 'generaldocs_threads.doc_thread_id',
          foreignField: '_id',
          as: 'generaldocs_threads.doc_thread_id'
        }
      },
      {
        $addFields: {
          'generaldocs_threads.doc_thread_id': {
            $arrayElemAt: ['$generaldocs_threads.doc_thread_id', 0]
          }
        }
      },
      {
        $group: {
          _id: '$_id',
          generaldocs_threads: { $push: '$generaldocs_threads' },
          applications: { $first: '$applications' },
          agents: { $first: '$agents' },
          editors: { $first: '$editors' },
          courses: { $first: '$courses' },
          root: { $first: '$$ROOT' }
        }
      },
      {
        $addFields: {
          generaldocs_threads: {
            $filter: {
              input: '$generaldocs_threads',
              as: 'thread',
              cond: { $ne: ['$$thread', {}] }
            }
          }
        }
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              '$root',
              {
                generaldocs_threads: '$generaldocs_threads',
                applications: '$applications',
                agents: '$agents',
                editors: '$editors',
                courses: '$courses'
              }
            ]
          }
        }
      },
      {
        $addFields: {
          hasApplications: { $gt: [{ $size: '$applications' }, 0] }
        }
      },
      {
        $facet: {
          withApplications: [
            { $match: { hasApplications: true } },
            { $unwind: '$applications' },
            {
              $lookup: {
                from: 'programs',
                localField: 'applications.programId',
                foreignField: '_id',
                as: 'applications.program'
              }
            },
            {
              $addFields: {
                'applications.programId': {
                  $arrayElemAt: ['$applications.program', 0]
                }
              }
            },
            {
              $group: {
                _id: '$_id',
                applications: { $push: '$applications' },
                agents: { $first: '$agents' },
                editors: { $first: '$editors' },
                generaldocs_threads: { $first: '$generaldocs_threads' },
                root: { $first: '$$ROOT' }
              }
            },
            {
              $replaceRoot: {
                newRoot: {
                  $mergeObjects: [
                    '$root',
                    {
                      applications: '$applications',
                      agents: '$agents',
                      editors: '$editors',
                      generaldocs_threads: '$generaldocs_threads'
                    }
                  ]
                }
              }
            }
          ],
          withoutApplications: [{ $match: { hasApplications: false } }]
        }
      },
      {
        $project: {
          result: {
            $concatArrays: ['$withApplications', '$withoutApplications']
          }
        }
      },
      {
        $unwind: '$result'
      },
      {
        $replaceRoot: { newRoot: '$result' }
      }
    ]);
    return students;
  }
};

module.exports = StudentService;
