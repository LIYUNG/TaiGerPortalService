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
const ApplicationQueryBuilder = require('../builders/ApplicationQueryBuilder');

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
    req,
    applicationQuery,
    selectFields,
    populateFields
  );
  res.status(200).send({ success: true, data: applications });
});

const getMyStudentsApplications = asyncHandler(async (req, res) => {
  const {
    params: { userId }
  } = req;
  const { decided, closed, admission } = req.query;
  const { filter: applicationQuery } = new ApplicationQueryBuilder()
    .withDecided(decided)
    .withClosed(closed)
    .withAdmission(admission)
    .build();
  const taiGerUser = await UserService.getUserById(req, userId);

  const applications =
    await ApplicationService.getStudentsApplicationsByTaiGerUserId(
      req,
      userId,
      applicationQuery
    );

  res.status(200).send({
    success: true,
    data: { applications, user: taiGerUser }
  });
});

const getActiveStudentsApplications = asyncHandler(async (req, res) => {
  const applications = await ApplicationService.getActiveStudentsApplications(
    req,
    {}
  );

  res.status(200).send({
    success: true,
    data: applications
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
    await StudentService.updateStudentById(req, user._id.toString(), {
      notification: obj
    });
  }
  const student = await StudentService.getStudentById(req, studentId);
  const applications = await ApplicationService.getApplicationsByStudentId(
    req,
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
  const student = await StudentService.getStudentById(req, studentId);

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
  const result = await ApplicationService.updateApplicationsBulk(req, updates);
  logger.info('updateStudentApplications: result', result);
  if (user.role === Role.Admin) {
    await StudentService.updateStudentById(req, studentId, {
      applying_program_count: parseInt(applying_program_count, 10)
    });
  }

  const updatedStudent = await StudentService.getStudentById(req, studentId);
  const newApplications = await ApplicationService.getApplicationsByStudentId(
    req,
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
    req,
    { _id: application_id },
    payload
  );
  res.status(200).send({ success: true, data: application });
  next();
});

const deleteApplication = asyncHandler(async (req, res, next) => {
  const { application_id } = req.params;
  await ApplicationService.deleteApplication(req, application_id);

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

  const student = await req.db.model('Student').findById(studentId);

  const applications = await req.db
    .model('Application')
    .find({ studentId })
    .populate('programId', '_id school program_name degree semester')
    .lean();

  const programObjectIds = program_id_set.map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const program_ids = await req.db
    .model('Program')
    .find({
      _id: { $in: programObjectIds },
      $or: [{ isArchiv: { $exists: false } }, { isArchiv: false }]
    })
    .lean();
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

  // Insert only new programIds for student.
  for (let i = 0; i < new_programIds.length; i += 1) {
    try {
      const application = await req.db.model('Application').create({
        studentId,
        programId: new mongoose.Types.ObjectId(new_programIds[i]),
        application_year
      });

      const program = program_ids.find(
        ({ _id }) => _id.toString() === new_programIds[i]
      );

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
          const Documentthread = req.db.model('Documentthread');
          const isRLSpecific = program.is_rl_specific;
          const NoRLSpecificFlag =
            isRLSpecific === undefined || isRLSpecific === null;
          // create specific RL tag if flag is false, or no flag and no requirement
          if (
            isRLSpecific === false ||
            (NoRLSpecificFlag && !program.rl_requirements)
          ) {
            // check if general RL is created, if not, create ones!
            const genThreadIds = student.generaldocs_threads.map(
              (thread) => thread.doc_thread_id
            );
            const generalRLcount = await req.db
              .model('Documentthread')
              .find({
                _id: { $in: genThreadIds },
                file_type: { $regex: /Recommendation_Letter_/ }
              })
              .countDocuments();

            if (generalRLcount < nrRLrequired) {
              // create general RL tasks
              logger.info('Create general RL tasks!');
              for (let j = generalRLcount; j < nrRLrequired; j += 1) {
                const newThread = new Documentthread({
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
              const newThread = new Documentthread({
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
        const Documentthread = req.db.model('Documentthread');

        for (const doc of PROGRAM_SPECIFIC_FILETYPE) {
          if (program[doc.required] === 'yes') {
            const new_doc_thread = new Documentthread({
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

  const applications_updated = await req.db
    .model('Application')
    .find({ studentId })
    .populate('programId', 'school program_name degree semester')
    .populate('doc_modification_thread.doc_thread_id', '-messages')
    .lean();

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

module.exports = {
  getApplications,
  deleteApplication,
  getMyStudentsApplications,
  getActiveStudentsApplications,
  getStudentApplications,
  updateStudentApplications,
  updateApplication,
  createApplicationV2
};
