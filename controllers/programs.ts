import type { Request, Response } from 'express';
import { Role, is_TaiGer_Agent } from '@taiger-common/core';
import type {
  GetProgramsResponse,
  GetProgramsOverviewResponse,
  GetProgramResponse,
  CreateProgramResponse,
  UpdateProgramResponse,
  DeleteProgramResponse,
  GetSchoolsDistributionResponse,
  GetSameProgramStudentsResponse,
  RefreshProgramResponse
} from '@taiger-common/model';

import { ErrorResponse } from '../common/errors';
import { asyncRoute } from '../middlewares/error-handler';
import logger from '../services/logger';
import ApplicationService from '../services/applications';
import ProgramService from '../services/programs';
import VCService from '../services/vs';
import ProgramRequirementService from '../services/programRequirements';
import TicketService from '../services/tickets';

const getDistinctSchoolsAttributes = async (req: Request, res: Response) => {
  try {
    const distinctCombinations = await ProgramService.aggregatePrograms([
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
      distinctCombinations as unknown as Record<string, unknown>
    );

    res.send({ success: true, data: distinctCombinations });
  } catch (error) {
    logger.error(
      'Error fetching distinct school and program combinations:',
      error as Record<string, unknown>
    );
    throw error;
  }
};

const updateBatchSchoolAttributes = async (req: Request, res: Response) => {
  const fields = req.body;
  logger.info('Distinct schools:', fields);
  try {
    const schools = await ProgramService.updateManyPrograms(
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
    logger.info(
      'Update school:',
      schools as unknown as Record<string, unknown>
    );
    res.send({ success: true });
  } catch (error) {
    logger.error(
      'Error fetching distinct schools:',
      error as Record<string, unknown>
    );
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
const getSchoolsDistribution = asyncRoute<GetSchoolsDistributionResponse>(
  async (req, res) => {
    try {
      const schools = await ProgramService.aggregatePrograms([
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
        data: schools.filter(
          (item) => item.school
        ) as unknown as GetSchoolsDistributionResponse['data']
      });
    } catch (error) {
      logger.error(
        'Error fetching schools distribution:',
        error as Record<string, unknown>
      );
      throw error;
    }
  }
);

const getProgramsOverview = asyncRoute<GetProgramsOverviewResponse>(
  async (req, res) => {
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
        ProgramService.countPrograms({ isArchiv: { $ne: true } }),

        // Total count of distinct schools
        ProgramService.aggregatePrograms([
          { $match: { isArchiv: { $ne: true } } },
          {
            $group: {
              _id: '$school'
            }
          },
          {
            $count: 'totalSchools'
          }
        ]).then((result) => result[0]?.totalSchools || 0),

        // Programs by country
        ProgramService.aggregatePrograms([
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
        ProgramService.aggregatePrograms([
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
        ProgramService.aggregatePrograms([
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
        ProgramService.aggregatePrograms([
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
        ProgramService.aggregatePrograms([
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
        ProgramService.aggregatePrograms([
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
        ProgramService.aggregatePrograms([
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
        ProgramService.findProgramsQuery(
          {
            isArchiv: { $ne: true },
            updatedAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            }
          },
          {
            select: 'school program_name degree semester updatedAt whoupdated',
            sort: { updatedAt: -1 },
            limit: 10
          }
        ),

        // Application statistics - programs with most applications
        ApplicationService.aggregateApplications([
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
            $unwind: {
              path: '$programDetails',
              preserveNullAndEmptyArrays: true
            }
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
      return res.send({
        success: true,
        data: overview as unknown as GetProgramsOverviewResponse['data']
      });
    } catch (error) {
      logger.error(
        'Error generating programs overview:',
        error as Record<string, unknown>
      );
      throw error;
    }
  }
);

const getPrograms = asyncRoute<GetProgramsResponse>(async (req, res) => {
  const { programs, total, page, limit } =
    await ProgramService.getProgramsPaginated(req.query);

  res.send({
    success: true,
    data: programs as unknown as GetProgramsResponse['data'],
    total,
    page,
    limit
  });
});

const getStudentsByProgram = async (req: Request, programId: string) => {
  const applications =
    await ApplicationService.getDecidedApplicationsByProgramPopulated(
      programId
    );

  const studentSet = new Set();
  applications.forEach((application: any) => {
    studentSet.add({
      ...application.studentId,
      application_year: application.application_year,
      agents: application.studentId.agents,
      closed: application.closed,
      admission: application.admission
    });
  });

  return Array.from(studentSet);
};

const getSameProgramStudents = asyncRoute<GetSameProgramStudentsResponse>(
  async (req, res) => {
    const { programId } = req.params as { programId: string };
    const students = await getStudentsByProgram(req, programId);
    return res.send({
      success: true,
      data: students as unknown as GetSameProgramStudentsResponse['data']
    });
  }
);

const getProgram = asyncRoute<GetProgramResponse>(async (req, res) => {
  const { user } = req;
  const { programId } = req.params as { programId: string };
  const program = await ProgramService.getProgramById(programId);
  if (!program) {
    logger.error('getProgram: Invalid program id');
    throw new ErrorResponse(404, 'Program not found');
  }

  let vc = null;

  if (
    user.role === Role.Admin ||
    is_TaiGer_Agent(user) ||
    user.role === Role.Editor ||
    user.role === Role.External
  ) {
    vc = await VCService.getVC({
      docId: programId,
      collectionName: 'Program'
    });
  }

  res.send({
    success: true,
    data: program as unknown as GetProgramResponse['data'],
    vc: vc as unknown as GetProgramResponse['vc']
  });
});

const createProgram = asyncRoute<CreateProgramResponse>(async (req, res) => {
  const { user } = req;
  const new_program = req.body;

  new_program.school = new_program.school.trim();
  new_program.program_name = new_program.program_name.trim();
  new_program.updatedAt = new Date();
  new_program.whoupdated = `${user.firstname} ${user.lastname}`;
  const programs = await ProgramService.getPrograms({
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
  const program = await ProgramService.createProgram(new_program);

  return res.status(201).send({
    success: true,
    data: program as unknown as CreateProgramResponse['data']
  });
});

const updateProgram = asyncRoute<UpdateProgramResponse>(async (req, res) => {
  const { user } = req;
  const { programId } = req.params as { programId: string };
  const fields = req.body;

  fields.updatedAt = new Date();
  fields.whoupdated = `${user.firstname} ${user.lastname}`;
  const fields_root = { ...fields };
  delete fields_root._id;
  delete fields_root.semester;
  delete fields_root.application_start;
  delete fields_root.application_deadline;

  const program = await ProgramService.updateProgramOne(
    { _id: programId },
    fields
  );

  if (!program) {
    logger.error('updateProgram: Invalid program id');
    throw new ErrorResponse(404, 'Program not found');
  }

  // Update same program but other semester common data
  await ProgramService.updateManyPrograms(
    {
      _id: { $ne: programId },
      school: program.school,
      program_name: program.program_name,
      degree: program.degree
    },
    fields_root
  );

  const vc = await VCService.getVC({
    docId: programId,
    collectionName: 'Program'
  });

  return res.status(200).send({
    success: true,
    data: program as unknown as UpdateProgramResponse['data'],
    vc: vc as unknown as UpdateProgramResponse['vc']
  });
});

const deleteProgram = asyncRoute<DeleteProgramResponse>(async (req, res) => {
  const { programId } = req.params as { programId: string };
  // All students including archived
  const applications = await ApplicationService.getApplicationsByProgramId(
    programId
  );

  // Check if anyone applied this program
  if (applications.length === 0) {
    logger.info('it can be safely deleted!');

    await ProgramService.archiveProgramById(programId);
    logger.info('The program deleted!');

    await ProgramRequirementService.deleteOneByProgramIds([programId]);
    await TicketService.deleteTicketsByProgramId(programId);
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

const refreshProgram = asyncRoute<RefreshProgramResponse>(async (req, res) => {
  const { user } = req;
  const { programId } = req.params as { programId: string };

  // Update program's updatedAt and whoupdated
  const now = new Date();
  const program = await ProgramService.updateProgramById(programId, {
    updatedAt: now,
    whoupdated: `${user.firstname} ${user.lastname}`
  });

  if (!program) {
    throw new ErrorResponse(404, 'Program not found');
  }

  // Manually add version control entry with field="none" and content message
  const docChanges = {
    originalValues: { none: null },
    updatedValues: {
      none: 'verified program information is up-to-date, unlock manually'
    },
    changedBy: `${user.firstname} ${user.lastname}`,
    changedAt: now
  };

  await VCService.pushChange(
    {
      docId: programId,
      collectionName: 'Program'
    },
    docChanges
  );

  const vc = await VCService.getVC({
    docId: programId,
    collectionName: 'Program'
  });

  return res.status(200).send({
    success: true,
    data: program as unknown as RefreshProgramResponse['data'],
    vc: vc as unknown as RefreshProgramResponse['vc']
  });
});

export = {
  getDistinctSchoolsAttributes,
  updateBatchSchoolAttributes,
  getStudentsByProgram,
  getProgramsOverview,
  getSchoolsDistribution,
  getPrograms,
  getSameProgramStudents,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  refreshProgram
};
