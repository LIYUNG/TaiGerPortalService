import { isNotArchiv, Role } from '@taiger-common/core';
import mongoose, { Schema } from 'mongoose';
import type {
  IApplication,
  IProgram,
  IStudent,
  GetApplicationsResponse,
  GetStudentApplicationsResponse,
  UpdateStudentApplicationsResponse,
  UpdateApplicationResponse,
  CreateApplicationResponse,
  RefreshApplicationResponse
} from '@taiger-common/model';

import { asyncRoute } from '../middlewares/error-handler';
import logger from '../services/logger';
import {
  GENERAL_RLs_CONSTANT,
  RLs_CONSTANT,
  PROGRAM_SPECIFIC_FILETYPE
} from '../constants';
import { createApplicationToStudentEmail } from '../services/email';
import { ErrorResponse } from '../common/errors';
import ApplicationService from '../services/applications';
import UserService from '../services/users';
import StudentService from '../services/students';
import ProgramService from '../services/programs';
import DocumentThreadService from '../services/documentthreads';
import ApplicationQueryBuilder from '../builders/ApplicationQueryBuilder';
import UserQueryBuilder from '../builders/UserQueryBuilder';
import { sendApplicationWithdrawNotificationToEditors } from '../utils/slackUtils';
import { add_portals_registered_status } from '../utils/utils_function';

// Build a mongoose ObjectId typed as the model's Schema.Types.ObjectId. The two
// ObjectId types are structurally interchangeable at runtime; this bridges the
// nominal mismatch between `mongoose.Types.ObjectId` and the model interfaces.
const toSchemaObjectId = (
  value: string | mongoose.Types.ObjectId
): Schema.Types.ObjectId =>
  new mongoose.Types.ObjectId(value) as unknown as Schema.Types.ObjectId;

// Type-only bridge: keep the original runtime value (no ObjectId construction),
// only reconcile the nominal Schema.Types.ObjectId mismatch.
const asSchemaObjectId = (value: unknown): Schema.Types.ObjectId =>
  value as Schema.Types.ObjectId;

// getStudentById returns a (lean) student onto which the controller attaches the
// student's applications before responding — mirror that shape for typed reads.
type StudentWithApplications = IStudent & {
  applications?: IApplication[];
};

// add_portals_registered_status assumes `programId` is populated to a full
// IProgram (the DAO lean-populates it); mirror that shape structurally, as
// controllers/students.ts does for the same helper.
type ApplicationWithProgram = Omit<IApplication, 'programId'> & {
  programId: IProgram;
};

export const getApplications = asyncRoute<GetApplicationsResponse>(
  async (req, res) => {
    const {
      decided,
      closed,
      admission,
      finalEnrolment,
      year,
      populate: populateFields = false
    } = req.query as {
      decided?: string;
      closed?: string;
      admission?: string;
      finalEnrolment?: string;
      year?: string;
      populate?: string | boolean;
    };
    const { filter: applicationQuery } = new ApplicationQueryBuilder()
      .withDecided(decided)
      .withClosed(closed)
      .withAdmission(admission)
      .withFinalEnrolment(finalEnrolment)
      .withApplicationYear(year)
      .build();

    const selectFields = [
      'programId',
      'studentId',
      'application_year',
      'decided',
      'closed',
      'admission',
      'finalEnrolment'
    ];

    const applications = await ApplicationService.getApplications(
      applicationQuery,
      selectFields,
      populateFields
    );
    res.status(200).send({
      success: true,
      data: applications as unknown as GetApplicationsResponse['data']
    });
  }
);

// Server-side paginated students' applications. Scoping is driven by query
// params:
// - `archiv`: `false` -> active (non-archived) students only; `true` -> archived
//   only; omitted -> all students (used by the admissions overview, which spans
//   archived students too).
// - `userId`: when set, scopes to the students that TaiGer user supervises (as
//   agent OR editor).
// NOTE: `data` is a server-side paginated payload (items + pagination meta), not
// the flat IApplicationPopulatedDef[] of GetActiveStudentsApplicationsResponse,
// so no api response type cleanly matches — left untyped.
export const getStudentsApplicationsPaginated = asyncRoute(async (req, res) => {
  const { userId, archiv } = req.query;

  const { filter } = new UserQueryBuilder()
    .withRole(Role.Student)
    .withArchiv(archiv)
    .build();

  if (userId) {
    // withArchiv(false) may have populated filter.$or (archiv condition); merge
    // the supervision condition via $and so neither clobbers the other.
    const supervisionOr = { $or: [{ agents: userId }, { editors: userId }] };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, supervisionOr];
      delete filter.$or;
    } else {
      Object.assign(filter, supervisionOr);
    }
  }

  const students = await StudentService.getStudents({
    filter,
    options: {}
  });

  const result = await ApplicationService.getStudentsApplicationsPaginated({
    studentIds: students.map((student) => student._id.toString()),
    query: req.query
  });

  res.status(200).send({
    success: true,
    data: result
  });
});

// Open-applications deadline distribution. Without `userId` it covers all
// active students; with `userId` it scopes to the students that TaiGer user
// supervises (as agent OR editor).
export const getApplicationsDeadlineDistribution = asyncRoute(
  async (req, res) => {
    const { userId } = req.query;

    const { filter } = new UserQueryBuilder()
      .withRole(Role.Student)
      .withArchiv(false)
      .build();

    if (userId) {
      const supervisionOr = { $or: [{ agents: userId }, { editors: userId }] };
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, supervisionOr];
        delete filter.$or;
      } else {
        Object.assign(filter, supervisionOr);
      }
    }

    const students = await StudentService.getStudents({
      filter,
      options: {}
    });

    const data =
      await ApplicationService.getActiveStudentsApplicationsDeadlineDistribution(
        {
          studentIds: students.map((student) => student._id.toString())
        }
      );

    res.status(200).send({ success: true, data });
  }
);

// Distinct programs (with update metadata) referenced by active students'
// applications, for the "Programs Update Status" tabs. Without `userId` it
// covers all active students; with `userId` it scopes to that user's supervised
// students. `decided=O` returns only programs with a decided application.
export const getApplicationProgramsUpdateStatus = asyncRoute(
  async (req, res) => {
    const { userId, decided } = req.query as {
      userId?: string;
      decided?: string;
    };

    const { filter } = new UserQueryBuilder()
      .withRole(Role.Student)
      .withArchiv(false)
      .build();

    if (userId) {
      const supervisionOr = { $or: [{ agents: userId }, { editors: userId }] };
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, supervisionOr];
        delete filter.$or;
      } else {
        Object.assign(filter, supervisionOr);
      }
    }

    const students = await StudentService.getStudents({
      filter,
      options: {}
    });

    const data = await ApplicationService.getApplicationProgramsUpdateStatus({
      studentIds: students.map((student) => student._id.toString()),
      decided
    });

    res.status(200).send({ success: true, data });
  }
);

// Aggregated application stats + the agent's user record for the AgentPage stat
// cards, computed in the DB (no full applications payload).
// NOTE: `data` is `{ user, stats }` — GetMyStudentsApplicationsResponse's data is
// `{ user, applications }`, a different shape, so it is left untyped.
export const getMyStudentsApplicationsStats = asyncRoute(async (req, res) => {
  const { userId } = req.params as { userId: string };

  const { filter } = new UserQueryBuilder()
    .withRole(Role.Student)
    .withArchiv(false)
    .build();
  const supervisionOr = { $or: [{ agents: userId }, { editors: userId }] };
  if (filter.$or) {
    filter.$and = [{ $or: filter.$or }, supervisionOr];
    delete filter.$or;
  } else {
    Object.assign(filter, supervisionOr);
  }

  const students = await StudentService.getStudents({
    filter,
    options: {}
  });
  const studentIds = students.map((student) => student._id.toString());

  const [stats, user] = await Promise.all([
    ApplicationService.getApplicationStatusStats({ studentIds }),
    UserService.getUserById(userId)
  ]);

  res.status(200).send({
    success: true,
    data: {
      user,
      stats: { totalStudents: studentIds.length, ...stats }
    }
  });
});

export const getStudentApplications =
  asyncRoute<GetStudentApplicationsResponse>(async (req, res) => {
    const { user } = req;
    const { studentId } = req.params as { studentId: string };

    // Clean up notification
    // TODO: deprecate this in the future.
    if (user.role === Role.Student) {
      const obj = user.notification!; // create object
      obj['isRead_new_programs_assigned'] = true; // set value
      await StudentService.updateStudentById(user._id.toString(), {
        notification: obj
      });
    }
    const student = (await StudentService.getStudentById(
      studentId
    )) as unknown as StudentWithApplications | null;
    if (!student) {
      logger.error('getStudentApplications: Invalid student id');
      throw new ErrorResponse(404, 'Invalid student id');
    }
    // Credentials must be explicitly selected (schema marks account/password
    // `select: false`) and then run through add_portals_registered_status,
    // which derives credential_a_filled / credential_b_filled and strips the
    // raw credentials before they leave the server. Without both steps those
    // flags come back undefined and the client's "Register University Portal"
    // checklist row is stuck open forever.
    const applications =
      (await ApplicationService.getApplicationsWithCredentialsByStudentId(
        studentId
      )) as unknown as ApplicationWithProgram[];
    student.applications = add_portals_registered_status(
      applications
    ) as unknown as IApplication[];
    if (user.role === Role.Student) {
      delete student.attributes;
    }
    res.status(200).send({
      success: true,
      data: student as unknown as GetStudentApplicationsResponse['data']
    });
  });

// TODO: application query updated not working, to be tested
export const updateStudentApplications =
  asyncRoute<UpdateStudentApplicationsResponse>(async (req, res) => {
    const {
      user,
      body: { applications, applying_program_count }
    } = req;
    const { studentId } = req.params as { studentId: string };
    // retrieve studentId differently depend on if student or Admin/Agent uploading the file
    const student = await StudentService.getStudentById(studentId);

    if (!student) {
      logger.error('updateStudentApplications: Invalid student id');
      throw new ErrorResponse(404, 'Invalid student id');
    }

    const updates = (applications as (IApplication & { _id?: unknown })[]).map(
      (app) => {
        const update = {
          decided: app.decided,
          closed: app.closed,
          admission: app.admission,
          finalEnrolment: app.finalEnrolment
        };
        return { updateOne: { filter: { _id: app._id }, update } };
      }
    );
    const result = await ApplicationService.updateApplicationsBulk(updates);
    logger.info('updateStudentApplications: result', { result });
    if (user.role === Role.Admin) {
      await StudentService.updateStudentById(studentId, {
        applying_program_count: parseInt(applying_program_count, 10)
      });
    }

    const updatedStudent = (await StudentService.getStudentById(
      studentId
    )) as unknown as StudentWithApplications | null;
    if (!updatedStudent) {
      logger.error('updateStudentApplications: Invalid student id');
      throw new ErrorResponse(404, 'Invalid student id');
    }
    const newApplications =
      (await ApplicationService.getApplicationsByStudentId(
        studentId
      )) as unknown as IApplication[];
    updatedStudent.applications = newApplications;
    res.status(201).send({
      success: true,
      data: updatedStudent as unknown as UpdateStudentApplicationsResponse['data']
    });
    // TODO: optimize email
    // if (is_TaiGer_Student(user)) {
    //   for (let i = 0; i < updatedStudent.agents.length; i += 1) {
    //     if (isNotArchiv(updatedStudent.agents[i])) {
    //       await UpdateStudentApplicationsEmail(
    //         {
    //           firstname: updatedStudent.agents[i].firstname,
    //           lastname: updatedStudent.agents[i].lastname,
    //           address: updatedStudent.agents[i].email
    //         },
    //         {
    //           student: updatedStudent,
    //           sender_firstname: updatedStudent.firstname,
    //           sender_lastname: updatedStudent.lastname,
    //           student_applications: updatedStudent.applications,
    //           new_app_decided_idx
    //         }
    //       );
    //     }
    //   }
    //   if (isNotArchiv(updatedStudent)) {
    //     await UpdateStudentApplicationsEmail(
    //       {
    //         firstname: updatedStudent.firstname,
    //         lastname: updatedStudent.lastname,
    //         address: updatedStudent.email
    //       },
    //       {
    //         student: updatedStudent,
    //         sender_firstname: updatedStudent.firstname,
    //         sender_lastname: updatedStudent.lastname,
    //         student_applications: updatedStudent.applications,
    //         new_app_decided_idx
    //       }
    //     );
    //   }

    //   if (new_task_flag) {
    //     for (let i = 0; i < updatedStudent.editors.length; i += 1) {
    //       if (isNotArchiv(updatedStudent.editors[i])) {
    //         if (isNotArchiv(updatedStudent)) {
    //           await NewMLRLEssayTasksEmail(
    //             {
    //               firstname: updatedStudent.editors[i].firstname,
    //               lastname: updatedStudent.editors[i].lastname,
    //               address: updatedStudent.editors[i].email
    //             },
    //             {
    //               sender_firstname: updatedStudent.firstname,
    //               sender_lastname: updatedStudent.lastname,
    //               student_applications: updatedStudent.applications,
    //               new_app_decided_idx
    //             }
    //           );
    //         }
    //       }
    //     }
    //   }
    // } else {
    //   if (isNotArchiv(updatedStudent)) {
    //     await UpdateStudentApplicationsEmail(
    //       {
    //         firstname: updatedStudent.firstname,
    //         lastname: updatedStudent.lastname,
    //         address: updatedStudent.email
    //       },
    //       {
    //         student: updatedStudent,
    //         sender_firstname: user.firstname,
    //         sender_lastname: user.lastname,
    //         student_applications: updatedStudent.applications,
    //         new_app_decided_idx
    //       }
    //     );
    //   }

    //   if (new_task_flag) {
    //     for (let i = 0; i < updatedStudent.editors.length; i += 1) {
    //       if (isNotArchiv(updatedStudent.editors[i])) {
    //         if (isNotArchiv(updatedStudent)) {
    //           await NewMLRLEssayTasksEmailFromTaiGer(
    //             {
    //               firstname: updatedStudent.editors[i].firstname,
    //               lastname: updatedStudent.editors[i].lastname,
    //               address: updatedStudent.editors[i].email
    //             },
    //             {
    //               student_firstname: updatedStudent.firstname,
    //               student_lastname: updatedStudent.lastname,
    //               sender_firstname: user.firstname,
    //               sender_lastname: user.lastname,
    //               student_applications: updatedStudent.applications,
    //               new_app_decided_idx
    //             }
    //           );
    //         }
    //       }
    //     }
    //   }
    // }
  });

export const updateApplication = asyncRoute<UpdateApplicationResponse>(
  async (req, res) => {
    const { application_id } = req.params;
    const payload = req.body;
    const application = await ApplicationService.updateApplication(
      { _id: application_id },
      payload
    );
    res.status(200).send({
      success: true,
      data: application as unknown as UpdateApplicationResponse['data']
    });
  }
);

// NOTE: no dedicated withdraw response type; the endpoint returns the updated
// application, so it reuses UpdateApplicationResponse.
export const withdrawApplication = asyncRoute<UpdateApplicationResponse>(
  async (req, res) => {
    const {
      body: { closed }
    } = req;
    const { studentId, application_id } = req.params as {
      studentId: string;
      application_id: string;
    };

    if (closed !== 'X' && closed !== '-') {
      throw new ErrorResponse(400, 'Invalid withdraw status');
    }

    const application = await ApplicationService.updateApplication(
      { _id: application_id },
      { closed }
    );

    if (!application) {
      logger.error('withdrawApplication: Invalid application id');
      throw new ErrorResponse(404, 'Application not found');
    }

    res.status(200).send({
      success: true,
      data: application as unknown as UpdateApplicationResponse['data']
    });

    const student = await StudentService.getStudentByIdPopulated(studentId, [
      ['editors', 'firstname lastname email slackId archiv']
    ]);

    if (!student) {
      logger.error('withdrawApplication: Invalid student id');
      return;
    }

    await sendApplicationWithdrawNotificationToEditors(
      student,
      application,
      closed === 'X'
    );
  }
);

// NOTE: DeleteApplicationResponse is only `{ success, message? }`, but this
// handler returns a `data: { message }` payload — a different shape — so it is
// left untyped rather than forcing an ill-fitting generic.
export const deleteApplication = asyncRoute(async (req, res) => {
  const { application_id } = req.params as { application_id: string };
  await ApplicationService.deleteApplication(application_id);

  res.status(200).send({
    success: true,
    data: { message: 'Application deleted successfully' }
  });
});

export const createApplicationV2 = asyncRoute<CreateApplicationResponse>(
  async (req, res) => {
    const {
      user,
      body: { program_id_set }
    } = req;
    const { studentId } = req.params as { studentId: string };
    // Limit the number of assigning programs
    const max_application = 20;
    if (program_id_set.length > max_application) {
      logger.error(
        'createApplication: too much program assigned: ',
        program_id_set.length
      );
      throw new ErrorResponse(
        400,
        `You assign too many programs to student. Please select max. ${max_application} programs.`
      );
    }

    const student = await StudentService.getStudentDocById(studentId);
    if (!student) {
      logger.error('createApplication: Invalid student id');
      throw new ErrorResponse(404, 'Invalid student id');
    }

    const applications = await ApplicationService.findByStudentIdPopulatedBasic(
      studentId
    );

    const programObjectIds = (program_id_set as string[]).map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    const program_ids = (await ProgramService.findPrograms({
      _id: { $in: programObjectIds },
      $or: [{ isArchiv: { $exists: false } }, { isArchiv: false }]
    })) as unknown as (IProgram & { _id: { toString(): string } })[];
    if (program_ids.length !== programObjectIds.length) {
      logger.error('createApplication: some program_ids invalid');
      throw new ErrorResponse(
        400,
        'Some Programs are out-of-date. Please refresh the page.'
      );
    }
    // limit the number in students application.
    if (applications.length + programObjectIds.length > max_application) {
      logger.error(
        `${student.firstname} ${student.lastname} has more than ${max_application} programs!`
      );
      throw new ErrorResponse(
        400,
        `${student.firstname} ${student.lastname} has more than ${max_application} programs!`
      );
    }

    const studentApplications = (applications as IApplication[]).map(
      ({ programId, application_year }) => ({
        programId: (
          programId as unknown as { _id: { toString(): string } }
        )._id.toString(),
        application_year
      })
    );

    // () TODO: check if the same university accept more than 1 application (different programs)
    // () TODO: differentiate the case of different year / semester?
    // () TODO: or only show warning?

    // Create programId array only new for student.
    const application_year =
      student.application_preference?.expected_application_date || '<TBD>';
    const new_programIds = (program_id_set as string[]).filter(
      (id) =>
        !studentApplications.some(
          (app) =>
            app.programId === id && app.application_year === application_year
        )
    );

    // Approval countries list (must match frontend APPROVAL_COUNTRIES)
    const APPROVAL_COUNTRIES = ['de', 'nl', 'uk', 'ch', 'se', 'at'];

    // Insert only new programIds for student.
    for (let i = 0; i < new_programIds.length; i += 1) {
      try {
        const program = program_ids.find(
          ({ _id }) => _id.toString() === new_programIds[i]
        );
        if (!program) {
          logger.error(
            `createApplication: program ${new_programIds[i]} not found`
          );
          throw new ErrorResponse(400, 'Some Programs are out-of-date.');
        }

        // Determine isLocked based on program country:
        // - Non-approval countries: isLocked = true (locked by default, requires manual unlock)
        // - Approval countries: isLocked = false (unlocked by default)
        const countryCode = program?.country
          ? String(program.country).toLowerCase()
          : null;
        const isInApprovalCountry = countryCode
          ? APPROVAL_COUNTRIES.includes(countryCode)
          : false;
        const isLocked = !isInApprovalCountry; // true for non-approval, false for approval

        const application = await ApplicationService.createApplicationDoc({
          studentId,
          programId: toSchemaObjectId(new_programIds[i]),
          application_year,
          isLocked // Set based on country
        });

        // check if RL required, if yes, create new thread
        // NOTE: `Number.isInteger(...) >= 0` compares a boolean against 0 — see
        // FLAGS. Preserving runtime behaviour, only silencing the type error.
        if (
          program.rl_required !== undefined &&
          (Number.isInteger(
            parseInt(program.rl_required, 10)
          ) as unknown as number) >= 0
        ) {
          try {
            // TODO: if no specific requirement,
            const nrRLrequired = parseInt(program.rl_required, 10);
            if (Number.isNaN(nrRLrequired)) {
              logger.error(
                `createApplication ${new_programIds[i]}: RL required is not a number`
              );
            }
            const isRLSpecific = program?.is_rl_specific;
            if (!isRLSpecific) {
              // check if general RL is created, if not, create ones!
              const genThreadIds = student.generaldocs_threads.map(
                (thread) => thread.doc_thread_id
              );
              const generalRLcount = await DocumentThreadService.countThreads({
                _id: { $in: genThreadIds },
                file_type: { $regex: /Recommendation_Letter_/ }
              });

              if (generalRLcount < nrRLrequired) {
                // create general RL tasks
                logger.info('Create general RL tasks!');
                for (let j = generalRLcount; j < nrRLrequired; j += 1) {
                  const newThread = DocumentThreadService.newThread({
                    student_id: toSchemaObjectId(studentId),
                    file_type: GENERAL_RLs_CONSTANT[j],
                    updatedAt: new Date()
                  });
                  const threadEntry =
                    application.doc_modification_thread.create({
                      doc_thread_id: toSchemaObjectId(newThread._id),
                      updatedAt: new Date(),
                      createdAt: new Date()
                    });

                  student.generaldocs_threads.push(threadEntry);
                  await newThread.save();
                }
              }
            } else {
              logger.info('Create specific RL tasks!');
              for (let j = 0; j < nrRLrequired; j += 1) {
                const newThread = DocumentThreadService.newThread({
                  student_id: toSchemaObjectId(studentId),
                  file_type: RLs_CONSTANT[j],
                  application_id: asSchemaObjectId(application._id),
                  program_id: toSchemaObjectId(new_programIds[i]),
                  updatedAt: new Date()
                });
                const threadEntry = application.doc_modification_thread.create({
                  doc_thread_id: asSchemaObjectId(newThread._id),
                  updatedAt: new Date(),
                  createdAt: new Date()
                });

                application.doc_modification_thread.push(threadEntry);
                await newThread.save();
                await application.save();
              }
            }
          } catch (error) {
            logger.error(
              `Error creating RL threads: ${(error as Error).message}`
            );
            throw new ErrorResponse(
              500,
              'Failed to create recommendation letter threads'
            );
          }
        }

        // Create supplementary form task
        try {
          for (const doc of PROGRAM_SPECIFIC_FILETYPE) {
            if (
              (program as unknown as Record<string, unknown>)[doc.required] ===
              'yes'
            ) {
              const new_doc_thread = DocumentThreadService.newThread({
                student_id: toSchemaObjectId(studentId),
                file_type: doc.fileType,
                application_id: asSchemaObjectId(application._id),
                program_id: toSchemaObjectId(new_programIds[i]),
                updatedAt: new Date()
              });
              const temp = application.doc_modification_thread.create({
                doc_thread_id: asSchemaObjectId(new_doc_thread._id),
                updatedAt: new Date(),
                createdAt: new Date()
              });

              application.doc_modification_thread.push(temp);
              await new_doc_thread.save();
              await application.save();
            }
          }
        } catch (error) {
          logger.error(
            `Error creating supplementary form threads: ${
              (error as Error).message
            }`
          );
          throw new ErrorResponse(
            500,
            'Failed to create supplementary form threads'
          );
        }

        if (student.notification) {
          student.notification.isRead_new_programs_assigned = false;
        }
      } catch (error) {
        logger.error(`Error creating application: ${(error as Error).message}`);
        throw new ErrorResponse(500, 'Failed to create application');
      }
    }
    await student.save();

    const applications_updated =
      await ApplicationService.findByStudentIdPopulatedFull(studentId);

    res.status(201).send({
      success: true,
      data: applications_updated as unknown as CreateApplicationResponse['data']
    });

    if (isNotArchiv(student as unknown as IStudent)) {
      // createApplicationToStudentEmail is an asyncHandler-wrapped helper (typed as
      // a 3-arg Express handler) invoked here as a 2-arg (recipient, msg) notifier.
      // Cast to its real call shape — TS-only, no runtime change. See FLAGS.
      const sendApplicationEmail =
        createApplicationToStudentEmail as unknown as (
          recipient: {
            firstname?: string | null;
            lastname?: string | null;
            address?: string | null;
          },
          msg: Record<string, unknown>
        ) => Promise<unknown>;
      await sendApplicationEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        {
          agent_firstname: user.firstname,
          agent_lastname: user.lastname,
          programs: program_ids
        }
      );
    }
  }
);

export const refreshApplication = asyncRoute<RefreshApplicationResponse>(
  async (req, res) => {
    const { applicationId } = req.params as { applicationId: string };

    // Unlock the application by setting isLocked to false
    const updatedApplication = await ApplicationService.unlockApplication(
      applicationId
    );

    if (!updatedApplication) {
      logger.error(
        `[refreshApplication] Application ${applicationId} not found`
      );
      return res
        .status(404)
        .json({ success: false, message: 'Application not found' });
    }

    return res.json({
      success: true,
      data: updatedApplication as unknown as RefreshApplicationResponse['data']
    });
  }
);
