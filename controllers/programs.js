const {
  Role,
  is_TaiGer_Agent,
  is_TaiGer_role
} = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { one_month_cache } = require('../cache/node-cache');
const { two_weeks_cache } = require('../cache/node-cache');
const { PROGRAMS_CACHE } = require('../config');
const ApplicationService = require('../services/applications');
const ProgramService = require('../services/programs');

const getDistinctSchoolsAttributes = async (req, res) => {
  try {
    const distinctCombinations = await req.db.model('Program').aggregate([
      {
        $group: {
          _id: {
            school: '$school',
            isPrivateSchool: '$isPrivateSchool',
            isPartnerSchool: '$isPartnerSchool',
            schoolType: '$schoolType',
            country: '$country',
            tags: '$tags'
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          school: '$_id.school',
          isPrivateSchool: '$_id.isPrivateSchool',
          isPartnerSchool: '$_id.isPartnerSchool',
          schoolType: '$_id.schoolType',
          country: '$_id.country',
          tags: '$_id.tags',
          count: 1
        }
      },
      {
        $sort: { school: 1 }
      }
    ]);

    logger.info(
      'Distinct school and program combinations:',
      distinctCombinations
    );

    res.send({ success: true, data: distinctCombinations });
  } catch (error) {
    logger.error(
      'Error fetching distinct school and program combinations:',
      error
    );
    throw error;
  }
};

const updateBatchSchoolAttributes = async (req, res) => {
  const fields = req.body;
  logger.info('Distinct schools:', fields);
  try {
    const schools = await req.db.model('Program').updateMany(
      {
        school: fields.school,
        $or: [
          { isPrivateSchool: { $ne: fields.isPrivateSchool } },
          { isPartnerSchool: { $ne: fields.isPartnerSchool } },
          { schoolType: { $ne: fields.schoolType } },
          { tags: { $ne: fields.tags } },
          { country: { $ne: fields.country } }
        ]
      },
      {
        $set: {
          isPrivateSchool: fields.isPrivateSchool,
          isPartnerSchool: fields.isPartnerSchool,
          schoolType: fields.schoolType,
          tags: fields.tags,
          country: fields.country
        }
      },
      { upsert: false }
    );
    logger.info('Update school:', schools);
    res.send({ success: true });
  } catch (error) {
    logger.error('Error fetching distinct schools:', error);
    throw error;
  }
};

/**
 * Get high-level overview and aggregated statistics about the Program collection
 * Provides metrics useful for dashboard and overview pages including:
 * - Total program count
 * - Distribution by country, degree, language, subject
 * - School type statistics
 * - Top schools by program count
 * - Recently updated programs
 * - Programs with most applications and admission statistics
 *
 * @route GET /api/programs/overview
 * @access Protected - Admin, Manager, Agent, Editor, External
 * @returns {Object} Overview object with aggregated program statistics
 */
/**
 * Get all schools with program counts
 * @route GET /api/programs/schools-distribution
 * @access Protected - Admin, Manager, Agent, Editor, External
 * @returns {Object} List of all schools with program counts
 */
const getSchoolsDistribution = asyncHandler(async (req, res) => {
  try {
    const schools = await req.db.model('Program').aggregate([
      { $match: { isArchiv: { $ne: true } } },
      {
        $group: {
          _id: {
            school: '$school',
            country: '$country',
            city: '$city'
          },
          programCount: { $sum: 1 }
        }
      },
      { $sort: { programCount: -1 } },
      {
        $project: {
          _id: 0,
          school: '$_id.school',
          country: '$_id.country',
          city: '$_id.city',
          programCount: 1
        }
      }
    ]);

    logger.info(`Retrieved ${schools.length} schools for distribution`);
    return res.send({
      success: true,
      data: schools.filter((item) => item.school)
    });
  } catch (error) {
    logger.error('Error fetching schools distribution:', error);
    throw error;
  }
});

const getProgramsOverview = asyncHandler(async (req, res) => {
  try {
    // Run multiple aggregations in parallel for better performance
    const [
      totalCount,
      totalSchools,
      byCountry,
      byDegree,
      byLanguage,
      bySubject,
      bySchoolType,
      topSchools,
      topContributors,
      recentlyUpdated,
      applicationStats
    ] = await Promise.all([
      // Total count of active programs
      req.db.model('Program').countDocuments({ isArchiv: { $ne: true } }),

      // Total count of distinct schools
      req.db
        .model('Program')
        .aggregate([
          { $match: { isArchiv: { $ne: true } } },
          {
            $group: {
              _id: '$school'
            }
          },
          {
            $count: 'totalSchools'
          }
        ])
        .then((result) => result[0]?.totalSchools || 0),

      // Programs by country
      req.db.model('Program').aggregate([
        { $match: { isArchiv: { $ne: true } } },
        {
          $group: {
            _id: '$country',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        {
          $project: {
            _id: 0,
            country: '$_id',
            count: 1
          }
        }
      ]),

      // Programs by degree
      req.db.model('Program').aggregate([
        { $match: { isArchiv: { $ne: true } } },
        {
          $group: {
            _id: '$degree',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        {
          $project: {
            _id: 0,
            degree: '$_id',
            count: 1
          }
        }
      ]),

      // Programs by language
      req.db.model('Program').aggregate([
        { $match: { isArchiv: { $ne: true } } },
        {
          $group: {
            _id: '$lang',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        {
          $project: {
            _id: 0,
            language: '$_id',
            count: 1
          }
        }
      ]),

      // Programs by subject (unwind array first)
      req.db.model('Program').aggregate([
        {
          $match: {
            isArchiv: { $ne: true },
            programSubjects: { $exists: true, $ne: [] }
          }
        },
        { $unwind: '$programSubjects' },
        {
          $group: {
            _id: '$programSubjects',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            subject: '$_id',
            count: 1
          }
        }
      ]),

      // Programs by school type
      req.db.model('Program').aggregate([
        { $match: { isArchiv: { $ne: true } } },
        {
          $group: {
            _id: {
              schoolType: '$schoolType',
              isPrivateSchool: '$isPrivateSchool',
              isPartnerSchool: '$isPartnerSchool'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        {
          $project: {
            _id: 0,
            schoolType: '$_id.schoolType',
            isPrivateSchool: '$_id.isPrivateSchool',
            isPartnerSchool: '$_id.isPartnerSchool',
            count: 1
          }
        }
      ]),

      // Top 10 schools by program count
      req.db.model('Program').aggregate([
        { $match: { isArchiv: { $ne: true } } },
        {
          $group: {
            _id: {
              school: '$school',
              country: '$country',
              city: '$city'
            },
            programCount: { $sum: 1 }
          }
        },
        { $sort: { programCount: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            school: '$_id.school',
            country: '$_id.country',
            city: '$_id.city',
            programCount: 1
          }
        }
      ]),

      // Top 10 contributors by update count
      req.db.model('Program').aggregate([
        {
          $match: {
            isArchiv: { $ne: true },
            whoupdated: { $exists: true, $nin: [null, ''] }
          }
        },
        {
          $group: {
            _id: '$whoupdated',
            updateCount: { $sum: 1 },
            lastUpdate: { $max: '$updatedAt' }
          }
        },
        { $sort: { updateCount: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            contributor: '$_id',
            updateCount: 1,
            lastUpdate: 1
          }
        }
      ]),

      // Recently updated programs (last 30 days)
      req.db
        .model('Program')
        .find({
          isArchiv: { $ne: true },
          updatedAt: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        })
        .select('school program_name degree semester updatedAt whoupdated')
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),

      // Application statistics - programs with most applications
      req.db.model('Application').aggregate([
        {
          $group: {
            _id: '$programId',
            totalApplications: { $sum: 1 },
            submittedCount: {
              $sum: { $cond: [{ $eq: ['$closed', 'O'] }, 1, 0] }
            },
            admittedCount: {
              $sum: { $cond: [{ $eq: ['$admission', 'O'] }, 1, 0] }
            },
            rejectedCount: {
              $sum: { $cond: [{ $eq: ['$admission', 'X'] }, 1, 0] }
            },
            pendingCount: {
              $sum: { $cond: [{ $eq: ['$admission', '-'] }, 1, 0] }
            }
          }
        },
        { $sort: { totalApplications: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'programs',
            localField: '_id',
            foreignField: '_id',
            as: 'programDetails'
          }
        },
        {
          $unwind: { path: '$programDetails', preserveNullAndEmptyArrays: true }
        },
        {
          $project: {
            _id: 0,
            programId: '$_id',
            school: '$programDetails.school',
            program_name: '$programDetails.program_name',
            degree: '$programDetails.degree',
            semester: '$programDetails.semester',
            country: '$programDetails.country',
            totalApplications: 1,
            submittedCount: 1,
            admittedCount: 1,
            rejectedCount: 1,
            pendingCount: 1,
            admissionRate: {
              $cond: [
                { $eq: ['$submittedCount', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$admittedCount', '$submittedCount'] },
                    100
                  ]
                }
              ]
            }
          }
        }
      ])
    ]);

    const overview = {
      totalPrograms: totalCount,
      totalSchools,
      byCountry: byCountry.filter((item) => item.country),
      byDegree: byDegree.filter((item) => item.degree),
      byLanguage: byLanguage.filter((item) => item.language),
      bySubject: bySubject.filter((item) => item.subject),
      bySchoolType,
      topSchools: topSchools.filter((item) => item.school),
      topContributors,
      recentlyUpdated,
      topApplicationPrograms: applicationStats.filter(
        (item) => item.school && item.program_name
      ),
      generatedAt: new Date()
    };

    logger.info('Programs overview generated successfully');
    return res.send({ success: true, data: overview });
  } catch (error) {
    logger.error('Error generating programs overview:', error);
    throw error;
  }
});

const getPrograms = asyncHandler(async (req, res) => {
  // Option 1 : Cache version
  if (PROGRAMS_CACHE === 'true') {
    const value = two_weeks_cache.get(req.originalUrl);
    if (value === undefined) {
      // cache miss
      const programs = await req.db
        .model('Program')
        .find({ isArchiv: { $ne: true } })
        .select(
          '-tuition_fees -website -special_notes -comments -optionalDocuments -requiredDocuments -uni_assist -daad_link -ml_required -ml_requirements -rl_required -essay_required -essay_requirements -application_portal_a -application_portal_b -fpso -program_duration -deprecated'
        );
      const success = two_weeks_cache.set(req.originalUrl, programs);
      if (success) {
        logger.info('programs cache set successfully');
      }
      return res.send({ success: true, data: programs });
    }
    res.send({ success: true, data: value });
  } else {
    // Option 2: No cache, good when programs are still frequently updated
    const programs = await req.db
      .model('Program')
      .find({ isArchiv: { $ne: true } })
      .select(
        '-tuition_fees -website -special_notes -comments -optionalDocuments -requiredDocuments -uni_assist -daad_link -ml_required -ml_requirements -rl_required -essay_required -essay_requirements -application_portal_a -application_portal_b -fpso -program_duration -deprecated'
      );
    res.send({ success: true, data: programs });
  }
});

const getStudentsByProgram = asyncHandler(async (req, programId) => {
  const applications = await req.db
    .model('Application')
    .find({
      programId,
      decided: 'O'
    })
    .populate({
      path: 'studentId',
      select: 'agents editors firstname lastname pictureUrl',
      populate: {
        path: 'agents editors',
        select: 'firstname lastname pictureUrl'
      }
    })
    .lean();

  const studentSet = new Set();
  applications.forEach((application) => {
    studentSet.add({
      ...application.studentId,
      application_year: application.application_year,
      agents: application.studentId.agents,
      closed: application.closed,
      admission: application.admission
    });
  });

  return Array.from(studentSet);
});

const getProgram = asyncHandler(async (req, res) => {
  const { user } = req;
  if (PROGRAMS_CACHE === 'true') {
    const value = one_month_cache.get(req.originalUrl);
    if (value === undefined) {
      // cache miss
      const program = await ProgramService.getProgramById(
        req,
        req.params.programId
      );
      if (!program) {
        logger.error('getProgram: Invalid program id');
        throw new ErrorResponse(404, 'Program not found');
      }
      const success = one_month_cache.set(req.originalUrl, program);
      if (success) {
        logger.info('programs cache set successfully');
      }
      if (is_TaiGer_role(user)) {
        const applications = await ApplicationService.getApplications(req, {
          programId: req.params.programId,
          decided: 'O'
        });
        const students = applications.map(
          (application) => application.studentId
        );

        const vc = await req.db
          .model('VC')
          .findOne({
            docId: req.params.programId,
            collectionName: 'Program'
          })
          .lean();

        return res.send({ success: true, data: program, students, vc });
      }
      return res.send({ success: true, data: program });
    }
    logger.info('programs cache hit');

    if (
      user.role === Role.Admin ||
      is_TaiGer_Agent(user) ||
      user.role === Role.Editor ||
      user.role === Role.External
    ) {
      let students = [];

      if (user.role !== Role.External) {
        students = await getStudentsByProgram(req, req.params.programId);
      }

      const vc = await req.db
        .model('VC')
        .findOne({
          docId: req.params.programId,
          collectionName: 'Program'
        })
        .lean();
      res.send({ success: true, data: value, students, vc });
    } else {
      res.send({ success: true, data: value });
    }
  } else if (
    user.role === Role.Admin ||
    is_TaiGer_Agent(user) ||
    user.role === Role.Editor ||
    user.role === Role.External
  ) {
    let students = [];

    let program = {};
    if (user.role !== Role.External) {
      students = await getStudentsByProgram(req, req.params.programId);
    }
    program = await ProgramService.getProgramById(req, req.params.programId);

    if (!program) {
      logger.error('getProgram: Invalid program id');
      throw new ErrorResponse(404, 'Program not found');
    }
    const vc = await req.db
      .model('VC')
      .findOne({
        docId: req.params.programId,
        collectionName: 'Program'
      })
      .lean();

    res.send({ success: true, data: program, students, vc });
  } else {
    const program = await ProgramService.getProgramById(
      req,
      req.params.programId
    );
    if (!program) {
      logger.error('getProgram: Invalid program id');
      throw new ErrorResponse(404, 'Program not found');
    }
    res.send({ success: true, data: program });
  }
});

const createProgram = asyncHandler(async (req, res) => {
  const { user } = req;
  const new_program = req.body;

  new_program.school = new_program.school.trim();
  new_program.program_name = new_program.program_name.trim();
  new_program.updatedAt = new Date();
  new_program.whoupdated = `${user.firstname} ${user.lastname}`;
  const programs = await ProgramService.getPrograms(req, {
    school: new_program.school,
    program_name: new_program.program_name,
    degree: new_program.degree,
    semester: new_program.semester,
    isArchiv: { $ne: true }
  });
  if (programs.length > 0) {
    logger.error('createProgram: same program existed!');
    throw new ErrorResponse(
      403,
      'This program is already existed! Considering update the existing one.'
    );
  }
  const program = await req.db.model('Program').create(new_program);
  return res.status(201).send({ success: true, data: program });
});

const updateProgram = asyncHandler(async (req, res) => {
  const { user } = req;
  const fields = req.body;

  fields.updatedAt = new Date();
  fields.whoupdated = `${user.firstname} ${user.lastname}`;
  const fields_root = { ...fields };
  delete fields_root._id;
  delete fields_root.semester;
  delete fields_root.application_start;
  delete fields_root.application_deadline;

  const program = await req.db
    .model('Program')
    .findOneAndUpdate({ _id: req.params.programId }, fields, {
      new: true
    });

  // Update same program but other semester common data
  await req.db.model('Program').updateMany(
    {
      _id: { $ne: req.params.programId },
      school: program.school,
      program_name: program.program_name,
      degree: program.degree
    },
    fields_root
  );

  const vc = await req.db
    .model('VC')
    .findOne({
      docId: req.params.programId,
      collectionName: 'Program'
    })
    .lean();

  // Delete cache key for image, pdf, docs, file here.
  const value = one_month_cache.del(req.originalUrl);
  if (value === 1) {
    logger.info('cache key deleted successfully due to update');
  }

  return res.status(200).send({ success: true, data: program, vc });
});

const deleteProgram = asyncHandler(async (req, res) => {
  // All students including archived
  const applications = await ApplicationService.getApplicationsByProgramId(
    req,
    req.params.programId
  );

  // Check if anyone applied this program
  if (applications.length === 0) {
    logger.info('it can be safely deleted!');

    await req.db
      .model('Program')
      .findByIdAndUpdate(req.params.programId, { isArchiv: true });
    logger.info('The program deleted!');

    const value = one_month_cache.del(req.originalUrl);
    if (value === 1) {
      logger.info('cache key deleted successfully due to delete');
    }
    await req.db
      .model('ProgramRequirement')
      .findOneAndDelete({ programId: { $in: [req.params.programId] } });
    await req.db
      .model('Ticket')
      .deleteMany({ program_id: req.params.programId });
    logger.info('Delete Tickets!');
  } else {
    logger.error('it can not be deleted!');
    logger.error('The following students have these programs!');
    const studentIds = applications
      .map((application) => application.studentId)
      .join(', ');
    logger.error(studentIds);
    throw new ErrorResponse(
      403,
      `This program can not be deleted! ${studentIds} are applying or considering this program.`
    );
  }
  res.status(200).send({ success: true });
});

module.exports = {
  getDistinctSchoolsAttributes,
  updateBatchSchoolAttributes,
  getStudentsByProgram,
  getProgramsOverview,
  getSchoolsDistribution,
  getPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram
};
