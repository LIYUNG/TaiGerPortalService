const { isNotArchiv, Role } = require('@taiger-common/core');
const mongoose = require('mongoose');

const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const {
  GENERAL_RLs_CONSTANT,
  RLs_CONSTANT,
  PROGRAM_SPECIFIC_FILETYPE
} = require('../constants');
const {
  createApplicationToStudentEmail,
  UpdateStudentApplicationsEmail,
  NewMLRLEssayTasksEmail,
  NewMLRLEssayTasksEmailFromTaiGer
} = require('../services/email');
const { ErrorResponse } = require('../common/errors');
const ApplicationService = require('../services/applications');
const UserService = require('../services/users');
const StudentService = require('../services/students');
const ProgramService = require('../services/programs');
const DocumentThreadService = require('../services/documentthreads');
const ApplicationQueryBuilder = require('../builders/ApplicationQueryBuilder');
const UserQueryBuilder = require('../builders/UserQueryBuilder');

const getApplications = asyncHandler(async (req, res) => {
  const {
    decided,
    closed,
    admission,
    finalEnrolment,
    year,
    populate: populateFields = false
  } = req.query;
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
  res.status(200).send({ success: true, data: applications });
});

// Server-side paginated active (non-archived) students' applications. Without
// `userId` it covers all active students; with `userId` (query param) it scopes
// to the students that TaiGer user supervises (as agent OR editor).
const getActiveStudentsApplicationsPaginated = asyncHandler(
  async (req, res) => {
    const { userId } = req.query;

    const { filter } = new UserQueryBuilder()
      .withRole(Role.Student)
      .withArchiv(false)
      .build();

    if (userId) {
      // withArchiv(false) already populated filter.$or (archiv condition); merge
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

    const result =
      await ApplicationService.getActiveStudentsApplicationsPaginated({
        studentIds: students.map((student) => student._id.toString()),
        query: req.query
      });

    res.status(200).send({
      success: true,
      data: result
    });
  }
);

// Open-applications deadline distribution. Without `userId` it covers all
// active students; with `userId` it scopes to the students that TaiGer user
// supervises (as agent OR editor).
const getApplicationsDeadlineDistribution = asyncHandler(async (req, res) => {
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
    await ApplicationService.getActiveStudentsApplicationsDeadlineDistribution({
      studentIds: students.map((student) => student._id.toString())
    });

  res.status(200).send({ success: true, data });
});

// Distinct programs (with update metadata) referenced by active students'
// applications, for the "Programs Update Status" tabs. Without `userId` it
// covers all active students; with `userId` it scopes to that user's supervised
// students. `decided=O` returns only programs with a decided application.
const getApplicationProgramsUpdateStatus = asyncHandler(async (req, res) => {
  const { userId, decided } = req.query;

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
});

// Aggregated application stats + the agent's user record for the AgentPage stat
// cards, computed in the DB (no full applications payload).
const getMyStudentsApplicationsStats = asyncHandler(async (req, res) => {
  const {
    params: { userId }
  } = req;

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

const getStudentApplications = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId }
  } = req;

  // Clean up notification
  // TODO: deprecate this in the future.
  if (user.role === Role.Student) {
    const obj = user.notification; // create object
    obj['isRead_new_programs_assigned'] = true; // set value
    await StudentService.updateStudentById(user._id.toString(), {
      notification: obj
    });
  }
  const student = await StudentService.getStudentById(studentId);
  const applications = await ApplicationService.getApplicationsByStudentId(
    studentId
  );
  student.applications = applications;
  if (user.role === Role.Student) {
    delete student.attributes;
  }
  res.status(200).send({ success: true, data: student });
});

// TODO: application query updated not working, to be tested
const updateStudentApplications = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: { applications, applying_program_count }
  } = req;
  // retrieve studentId differently depend on if student or Admin/Agent uploading the file
  const student = await StudentService.getStudentById(studentId);

  if (!student) {
    logger.error('updateStudentApplications: Invalid student id');
    throw new ErrorResponse(404, 'Invalid student id');
  }

  const updates = applications.map((app) => {
    const update = {
      decided: app.decided,
      closed: app.closed,
      admission: app.admission,
      finalEnrolment: app.finalEnrolment
    };
    return { updateOne: { filter: { _id: app._id }, update } };
  });
  const result = await ApplicationService.updateApplicationsBulk(updates);
  logger.info('updateStudentApplications: result', result);
  if (user.role === Role.Admin) {
    await StudentService.updateStudentById(studentId, {
      applying_program_count: parseInt(applying_program_count, 10)
    });
  }

  const updatedStudent = await StudentService.getStudentById(studentId);
  const newApplications = await ApplicationService.getApplicationsByStudentId(
    studentId
  );
  updatedStudent.applications = newApplications;
  res.status(201).send({ success: true, data: updatedStudent });
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
  next();
});

const updateApplication = asyncHandler(async (req, res, next) => {
  const { application_id } = req.params;
  const payload = req.body;
  const application = await ApplicationService.updateApplication(
    { _id: application_id },
    payload
  );
  res.status(200).send({ success: true, data: application });
  next();
});

const deleteApplication = asyncHandler(async (req, res, next) => {
  const { application_id } = req.params;
  await ApplicationService.deleteApplication(application_id);

  res.status(200).send({
    success: true,
    data: { message: 'Application deleted successfully' }
  });

  next();
});

const createApplicationV2 = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: { program_id_set }
  } = req;
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

  const applications = await ApplicationService.findByStudentIdPopulatedBasic(
    studentId
  );

  const programObjectIds = program_id_set.map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const program_ids = await ProgramService.findPrograms({
    _id: { $in: programObjectIds },
    $or: [{ isArchiv: { $exists: false } }, { isArchiv: false }]
  });
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

  const studentApplications = applications.map(
    ({ programId, application_year }) => ({
      programId: programId._id.toString(),
      application_year
    })
  );

  // () TODO: check if the same university accept more than 1 application (different programs)
  // () TODO: differentiate the case of different year / semester?
  // () TODO: or only show warning?

  // Create programId array only new for student.
  const application_year =
    student.application_preference?.expected_application_date || '<TBD>';
  const new_programIds = program_id_set.filter(
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
        programId: new mongoose.Types.ObjectId(new_programIds[i]),
        application_year,
        isLocked // Set based on country
      });

      // check if RL required, if yes, create new thread
      if (
        program.rl_required !== undefined &&
        Number.isInteger(parseInt(program.rl_required, 10)) >= 0
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
                  student_id: new mongoose.Types.ObjectId(studentId),
                  file_type: GENERAL_RLs_CONSTANT[j],
                  updatedAt: new Date()
                });
                const threadEntry = application.doc_modification_thread.create({
                  doc_thread_id: new mongoose.Types.ObjectId(newThread._id),
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
                student_id: new mongoose.Types.ObjectId(studentId),
                file_type: RLs_CONSTANT[j],
                application_id: application._id,
                program_id: new mongoose.Types.ObjectId(new_programIds[i]),
                updatedAt: new Date()
              });
              const threadEntry = application.doc_modification_thread.create({
                doc_thread_id: newThread._id,
                updatedAt: new Date(),
                createdAt: new Date()
              });

              application.doc_modification_thread.push(threadEntry);
              await newThread.save();
              await application.save();
            }
          }
        } catch (error) {
          logger.error(`Error creating RL threads: ${error.message}`);
          throw new ErrorResponse(
            500,
            'Failed to create recommendation letter threads'
          );
        }
      }

      // Create supplementary form task
      try {
        for (const doc of PROGRAM_SPECIFIC_FILETYPE) {
          if (program[doc.required] === 'yes') {
            const new_doc_thread = DocumentThreadService.newThread({
              student_id: new mongoose.Types.ObjectId(studentId),
              file_type: doc.fileType,
              application_id: application._id,
              program_id: new mongoose.Types.ObjectId(new_programIds[i]),
              updatedAt: new Date()
            });
            const temp = application.doc_modification_thread.create({
              doc_thread_id: new_doc_thread._id,
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
          `Error creating supplementary form threads: ${error.message}`
        );
        throw new ErrorResponse(
          500,
          'Failed to create supplementary form threads'
        );
      }

      student.notification.isRead_new_programs_assigned = false;
    } catch (error) {
      logger.error(`Error creating application: ${error.message}`);
      throw new ErrorResponse(500, 'Failed to create application');
    }
  }
  await student.save();

  const applications_updated =
    await ApplicationService.findByStudentIdPopulatedFull(studentId);

  res.status(201).send({ success: true, data: applications_updated });

  if (isNotArchiv(student)) {
    await createApplicationToStudentEmail(
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
  next();
});

const refreshApplication = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;

  // Unlock the application by setting isLocked to false
  const updatedApplication = await ApplicationService.unlockApplication(
    applicationId
  );

  if (!updatedApplication) {
    console.error(
      `[refreshApplication] Application ${applicationId} not found`
    );
    return res
      .status(404)
      .json({ success: false, message: 'Application not found' });
  }

  return res.json({ success: true, data: updatedApplication });
});

module.exports = {
  getApplications,
  deleteApplication,
  getActiveStudentsApplicationsPaginated,
  getApplicationsDeadlineDistribution,
  getApplicationProgramsUpdateStatus,
  getMyStudentsApplicationsStats,
  getStudentApplications,
  updateStudentApplications,
  updateApplication,
  createApplicationV2,
  refreshApplication
};
