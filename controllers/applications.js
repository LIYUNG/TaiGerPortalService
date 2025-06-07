const {
  isNotArchiv,
  Role,
  isProgramDecided,
  isProgramSubmitted,
  is_TaiGer_Student,
  is_TaiGer_Agent,
  is_TaiGer_Editor
} = require('@taiger-common/core');
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
const DocumentThreadService = require('../services/documentthreads');

const getMyStudentsApplications = asyncHandler(async (req, res) => {
  const {
    params: { userId }
  } = req;
  const taiGerUser = await UserService.getUserById(req, userId);
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };

  if (is_TaiGer_Agent(taiGerUser)) {
    studentQuery.agents = taiGerUser._id.toString();
  } else if (is_TaiGer_Editor(taiGerUser)) {
    studentQuery.editors = taiGerUser._id.toString();
  }
  const applications =
    await ApplicationService.getStudentsApplicationsByTaiGerUserId(req, userId);

  const students = await StudentService.fetchStudentsWithGeneralThreadsInfo(
    req,
    studentQuery
  );
  res.status(200).send({
    success: true,
    data: { applications, students, user: taiGerUser }
  });
});

const getActiveStudentsApplications = asyncHandler(async (req, res) => {
  const studentQuery = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };

  const applications = await ApplicationService.getActiveStudentsApplications(
    req
  );

  const students = await StudentService.fetchStudentsWithGeneralThreadsInfo(
    req,
    studentQuery
  );
  res.status(200).send({
    success: true,
    data: { applications, students }
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

  const oldApplications = await ApplicationService.getApplicationsByStudentId(
    req,
    studentId
  );

  let new_task_flag = false;
  if (!student) {
    logger.error('updateStudentApplications: Invalid student id');
    throw new ErrorResponse(404, 'Invalid student id');
  }
  const new_app_decided_idx = [];
  for (let i = 0; i < applications.length; i += 1) {
    const application_idx = oldApplications.findIndex(
      (app) => app._id == applications[i]._id
    );
    const application = oldApplications.find(
      (app) => app._id == applications[i]._id
    );
    if (!application) {
      logger.error('updateStudentApplications: Invalid document status');
      throw new ErrorResponse(
        404,
        'Invalid application. Please refresh the page and try updating again.'
      );
    }
    if (
      isProgramDecided(applications[i]) &&
      application.decided !== applications[i].decided
    ) {
      // if applications[i].decided === 'yes',
      // send ML/RL/Essay Tasks link in Email for eidtor, student
      // Add new tasks and send to email
      new_app_decided_idx.push(application_idx);
      if (
        application.programId.uni_assist &&
        application.programId.uni_assist.includes('Yes')
      ) {
        student.notification.isRead_uni_assist_task_assigned = false;
      }
      // add reminder banner
      student.notification.isRead_new_cvmlrl_tasks_created = false;
      new_task_flag = true;
    }
    application.decided = applications[i].decided;
    application.closed = applications[i].closed;

    if (isProgramSubmitted(application)) {
      for (let k = 0; k < application.doc_modification_thread.length; k += 1) {
        application.doc_modification_thread[k].updatedAt = new Date();
        await DocumentThreadService.updateThread(
          req,
          {
            application_id: application._id,
            student_id: student._id
          },
          {
            isFinalVersion: true,
            updatedAt: new Date()
          }
        );
      }
    }
    application.admission = applications[i].admission;
    application.finalEnrolment = applications[i].finalEnrolment;
  }
  if (user.role === Role.Admin) {
    student.applying_program_count = parseInt(applying_program_count, 10);
  }
  await student.save();

  const student_updated = await StudentService.getStudentById(req, studentId);

  res.status(201).send({ success: true, data: student_updated });
  if (is_TaiGer_Student(user)) {
    for (let i = 0; i < student_updated.agents.length; i += 1) {
      if (isNotArchiv(student_updated.agents[i])) {
        await UpdateStudentApplicationsEmail(
          {
            firstname: student_updated.agents[i].firstname,
            lastname: student_updated.agents[i].lastname,
            address: student_updated.agents[i].email
          },
          {
            student: student_updated,
            sender_firstname: student_updated.firstname,
            sender_lastname: student_updated.lastname,
            student_applications: student_updated.applications,
            new_app_decided_idx
          }
        );
      }
    }
    if (isNotArchiv(student_updated)) {
      await UpdateStudentApplicationsEmail(
        {
          firstname: student_updated.firstname,
          lastname: student_updated.lastname,
          address: student_updated.email
        },
        {
          student: student_updated,
          sender_firstname: student_updated.firstname,
          sender_lastname: student_updated.lastname,
          student_applications: student_updated.applications,
          new_app_decided_idx
        }
      );
    }

    if (new_task_flag) {
      for (let i = 0; i < student_updated.editors.length; i += 1) {
        if (isNotArchiv(student_updated.editors[i])) {
          if (isNotArchiv(student_updated)) {
            await NewMLRLEssayTasksEmail(
              {
                firstname: student_updated.editors[i].firstname,
                lastname: student_updated.editors[i].lastname,
                address: student_updated.editors[i].email
              },
              {
                sender_firstname: student_updated.firstname,
                sender_lastname: student_updated.lastname,
                student_applications: student_updated.applications,
                new_app_decided_idx
              }
            );
          }
        }
      }
    }
  } else {
    if (isNotArchiv(student_updated)) {
      await UpdateStudentApplicationsEmail(
        {
          firstname: student_updated.firstname,
          lastname: student_updated.lastname,
          address: student_updated.email
        },
        {
          student: student_updated,
          sender_firstname: user.firstname,
          sender_lastname: user.lastname,
          student_applications: student_updated.applications,
          new_app_decided_idx
        }
      );
    }

    if (new_task_flag) {
      for (let i = 0; i < student_updated.editors.length; i += 1) {
        if (isNotArchiv(student_updated.editors[i])) {
          if (isNotArchiv(student_updated)) {
            await NewMLRLEssayTasksEmailFromTaiGer(
              {
                firstname: student_updated.editors[i].firstname,
                lastname: student_updated.editors[i].lastname,
                address: student_updated.editors[i].email
              },
              {
                student_firstname: student_updated.firstname,
                student_lastname: student_updated.lastname,
                sender_firstname: user.firstname,
                sender_lastname: user.lastname,
                student_applications: student_updated.applications,
                new_app_decided_idx
              }
            );
          }
        }
      }
    }
  }
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
  deleteApplication,
  getMyStudentsApplications,
  getActiveStudentsApplications,
  getStudentApplications,
  updateStudentApplications,
  updateApplication,
  createApplicationV2
};
