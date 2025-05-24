const path = require('path');
const {
  Role,
  DocumentStatusType,
  is_TaiGer_Student,
  isProgramSubmitted,
  isProgramDecided
} = require('@taiger-common/core');

const { asyncHandler } = require('../middlewares/error-handler');
const { one_month_cache, two_month_cache } = require('../cache/node-cache');
const { ErrorResponse } = require('../common/errors');
const { isNotArchiv } = require('../constants');
const {
  deleteTemplateSuccessEmail,
  sendAgentUploadedProfileFilesForStudentEmail,
  sendAgentUploadedVPDForStudentEmail,
  sendUploadedProfileFilesRemindForAgentEmail,
  sendUploadedVPDRemindForAgentEmail,
  sendChangedProfileFileStatusEmail,
  UpdateStudentApplicationsEmail,
  NewMLRLEssayTasksEmail,
  NewMLRLEssayTasksEmailFromTaiGer,
  AdmissionResultInformEmailToTaiGer
  // sendSomeReminderEmail,
} = require('../services/email');
const { AWS_S3_BUCKET_NAME, AWS_S3_PUBLIC_BUCKET_NAME } = require('../config');
const logger = require('../services/logger');

const { deleteS3Object } = require('../aws/s3');
const { getS3Object } = require('../aws/s3');

const getTemplates = asyncHandler(async (req, res, next) => {
  const templates = await req.db.model('Template').find({});

  res.status(201).send({ success: true, data: templates });
  next();
});

// (O) email admin delete template
const deleteTemplate = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const { category_name } = req.params;

  const template = await req.db.model('Template').findOne({ category_name });

  let document_split = template.path.replace(/\\/g, '/');
  document_split = document_split.split('/');
  const [directory, fileName] = document_split;
  const fileKey = path.join(directory, fileName).replace(/\\/g, '/');
  logger.info('Trying to delete file', fileKey);

  try {
    await deleteS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
    const value = two_month_cache.del(fileKey);
    if (value === 1) {
      logger.info('Template cache key deleted successfully');
    }
  } catch (err) {
    if (err) {
      logger.error('deleteTemplate: ', err);
      throw new ErrorResponse(500, 'Error occurs while deleting');
    }
  }
  await req.db.model('Template').findOneAndDelete({ category_name });
  const templates = await req.db.model('Template').find({});
  res.status(200).send({ success: true, data: templates });
  await deleteTemplateSuccessEmail(
    {
      firstname: user.firstname,
      lastname: user.lastname,
      address: user.email
    },
    {
      category_name,
      updatedAt: new Date()
    }
  );
  next();
});

// (O) email admin uploaded template successfully
const uploadTemplate = asyncHandler(async (req, res, next) => {
  const { category_name } = req.params;

  const updated_templates = await req.db.model('Template').findOneAndUpdate(
    { category_name },
    {
      name: req.file.key,
      category_name,
      path: req.file.key,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  res.status(201).send({ success: true, data: updated_templates });
  next();
});

const downloadTemplateFile = asyncHandler(async (req, res, next) => {
  const {
    params: { category_name }
  } = req;

  const template = await req.db.model('Template').findOne({ category_name });
  // AWS S3
  // download the file via aws s3 here
  let document_split = template.path.replace(/\\/g, '/');
  document_split = document_split.split('/');
  const [directory, fileName] = document_split;
  const fileKey = path.join(directory, fileName).replace(/\\/g, '/');
  logger.info('Trying to download template file', fileKey);

  const value = two_month_cache.get(fileKey); // vpd name
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
    const success = two_month_cache.set(fileKey, Buffer.from(response));
    if (success) {
      logger.info('Template file cache set successfully');
    }
    res.attachment(fileKey);
    res.end(response);
    next();
  } else {
    logger.info('Template file cache hit');
    res.attachment(fileKey);
    res.end(value);
    next();
  }
});

// (O) email : student notification
// (O) email : agent notification
const saveProfileFilePath = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId, category }
  } = req;
  // retrieve studentId differently depend on if student or Admin/Agent uploading the file
  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('agents editors', 'firstname lastname email archiv')
    .populate('applications.programId');
  if (!student) {
    logger.error(`saveProfileFilePath: Invalid student id ${studentId}`);
    throw new ErrorResponse(404, 'student id not found');
  }
  let document = student.profile.find(({ name }) => name === category);
  if (!document) {
    document = student.profile.create({ name: category });
    document.status = DocumentStatusType.Uploaded;
    document.required = true;
    document.updatedAt = new Date();
    document.path = req.file.key;
    student.profile.push(document);
    await student.save();
    res.status(201).send({ success: true, data: document });
    if (is_TaiGer_Student(user)) {
      // TODO: add notification for agents
      for (let i = 0; i < student.agents.length; i += 1) {
        const agent = await req.db
          .model('Agent')
          .findById(student.agents[i]._id.toString());
        if (agent.agent_notification) {
          const temp_student =
            agent.agent_notification.isRead_new_base_docs_uploaded.find(
              (std_obj) => std_obj.student_id === student._id.toString()
            );
          // if not notified yet:
          if (!temp_student) {
            agent.agent_notification.isRead_new_base_docs_uploaded.push({
              student_id: student._id.toString(),
              student_firstname: student.firstname,
              student_lastname: student.lastname
            });
          }
          // else: nothing to do as there was a notification before.
        }
        await agent.save();
      }

      for (let i = 0; i < student.agents.length; i += 1) {
        if (isNotArchiv(student.agents[i])) {
          await sendUploadedProfileFilesRemindForAgentEmail(
            {
              firstname: student.agents[i].firstname,
              lastname: student.agents[i].lastname,
              address: student.agents[i].email
            },
            {
              student_firstname: student.firstname,
              student_lastname: student.lastname,
              student_id: student._id.toString(),
              uploaded_documentname: document.name.replace(/_/g, ' '),
              uploaded_updatedAt: document.updatedAt
            }
          );
        }
      }
    } else if (isNotArchiv(student)) {
      await sendAgentUploadedProfileFilesForStudentEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        {
          agent_firstname: user.firstname,
          agent_lastname: user.lastname,
          uploaded_documentname: document.name.replace(/_/g, ' '),
          uploaded_updatedAt: document.updatedAt
        }
      );
    }
  } else {
    document.status = DocumentStatusType.Uploaded;
    document.required = true;
    document.updatedAt = new Date();
    document.path = req.file.key;
    await student.save();

    // retrieve studentId differently depend on if student or Admin/Agent uploading the file
    res.status(201).send({ success: true, data: document });
    if (is_TaiGer_Student(user)) {
      // TODO: notify agents
      for (let i = 0; i < student.agents.length; i += 1) {
        const agent = await req.db
          .model('Agent')
          .findById(student.agents[i]._id.toString());
        if (agent.agent_notification) {
          const temp_student =
            agent.agent_notification.isRead_new_base_docs_uploaded.find(
              (std_obj) => std_obj.student_id === student._id.toString()
            );
          // if not notified yet:
          if (!temp_student) {
            agent.agent_notification.isRead_new_base_docs_uploaded.push({
              // eslint-disable-next-line no-underscore-dangle
              student_id: student._id.toString(),
              student_firstname: student.firstname,
              student_lastname: student.lastname
            });
          }
          // else: nothing to do as there was a notification before.
        }
        await agent.save();
      }

      // Reminder for Agent:
      for (let i = 0; i < student.agents.length; i += 1) {
        if (isNotArchiv(student.agents[i])) {
          await sendUploadedProfileFilesRemindForAgentEmail(
            {
              firstname: student.agents[i].firstname,
              lastname: student.agents[i].lastname,
              address: student.agents[i].email
            },
            {
              student_firstname: student.firstname,
              student_lastname: student.lastname,
              student_id: student._id.toString(),
              uploaded_documentname: document.name.replace(/_/g, ' '),
              uploaded_updatedAt: document.updatedAt
            }
          );
        }
      }
    } else if (isNotArchiv(student)) {
      await sendAgentUploadedProfileFilesForStudentEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        {
          agent_firstname: user.firstname,
          agent_lastname: user.lastname,
          uploaded_documentname: document.name.replace(/_/g, ' '),
          uploaded_updatedAt: document.updatedAt
        }
      );
    }
  }
  next();
});

const updateVPDPayment = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, program_id },
    body: { isPaid }
  } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId');

  if (!student) {
    logger.error('updateVPDPayment: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }
  const app = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );
  if (!app) {
    logger.error('updateVPDPayment: Invalid program id!');
    throw new ErrorResponse(404, 'Application not found');
  }

  app.uni_assist.isPaid = isPaid;
  app.uni_assist.updatedAt = new Date();
  await student.save();

  const updatedApplication = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );

  // retrieve studentId differently depend on if student or Admin/Agent uploading the file
  res.status(201).send({ success: true, data: updatedApplication });
  next();
});
// () email:

const updateVPDFileNecessity = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, program_id }
  } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId');

  if (!student) {
    logger.error('updateVPDFileNecessity: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }
  const app = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );
  if (!app) {
    logger.error('updateVPDFileNecessity: Invalid program id!');
    throw new ErrorResponse(404, 'Application not found');
  }
  // TODO: set bot notneeded and resume needed
  if (app.uni_assist.status !== DocumentStatusType.NotNeeded) {
    app.uni_assist.status = DocumentStatusType.NotNeeded;
  } else {
    app.uni_assist.status = DocumentStatusType.Missing;
  }
  app.uni_assist.updatedAt = new Date();
  app.uni_assist.vpd_file_path = '';
  await student.save();

  const updatedApplication = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );

  res.status(201).send({ success: true, data: updatedApplication });
  next();
});

// (O) email : student notification
// (O) email : agent notification
const saveVPDFilePath = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId, program_id, fileType }
  } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId');

  if (!student) {
    logger.error('saveVPDFilePath: Invalid student id!');
    throw new ErrorResponse(404, 'Invalid student id');
  }
  const app = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );
  if (!app) {
    app.uni_assist.status = DocumentStatusType.Uploaded;
    app.uni_assist.updatedAt = new Date();
    app.uni_assist.vpd_file_path = req.file.key;
    await student.save();
    const updatedApplication = student.applications.find(
      (application) => application.programId._id.toString() === program_id
    );
    res.status(201).send({ success: true, data: updatedApplication });

    return;
  }
  if (fileType === 'VPD') {
    app.uni_assist.status = DocumentStatusType.Uploaded;
    app.uni_assist.updatedAt = new Date();
    app.uni_assist.vpd_file_path = req.file.key;
  }
  if (fileType === 'VPDConfirmation') {
    // app.uni_assist.status = DocumentStatusType.Uploaded;
    app.uni_assist.updatedAt = new Date();
    app.uni_assist.vpd_paid_confirmation_file_path = req.file.key;
  }

  await student.save();
  const updatedApplication = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );
  // retrieve studentId differently depend on if student or Admin/Agent uploading the file
  res.status(201).send({ success: true, data: updatedApplication });

  const student_updated = await req.db
    .model('Student')
    .findById(studentId)
    .populate('agents', 'firstname lastname email archiv');

  if (is_TaiGer_Student(user)) {
    // Reminder for Agent:
    for (let i = 0; i < student_updated.agents.length; i += 1) {
      if (isNotArchiv(student_updated.agents[i])) {
        await sendUploadedVPDRemindForAgentEmail(
          {
            firstname: student_updated.agents[i].firstname,
            lastname: student_updated.agents[i].lastname,
            address: student_updated.agents[i].email
          },
          {
            student_firstname: student_updated.firstname,
            student_lastname: student_updated.lastname,
            student_id: student_updated._id.toString(),
            fileType,
            uploaded_documentname: req.file.key.replace(/_/g, ' '),
            uploaded_updatedAt: app.uni_assist.updatedAt
          }
        );
      }
    }
  } else if (isNotArchiv(student_updated)) {
    await sendAgentUploadedVPDForStudentEmail(
      {
        firstname: student_updated.firstname,
        lastname: student_updated.lastname,
        address: student_updated.email
      },
      {
        agent_firstname: user.firstname,
        agent_lastname: user.lastname,
        fileType,
        uploaded_documentname: req.file.key.replace(/_/g, ' '),
        uploaded_updatedAt: app.uni_assist.updatedAt
      }
    );
  }
  next();
});

const downloadVPDFile = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId, program_id, fileType }
  } = req;

  // AWS S3
  // download the file via aws s3 here
  const student = await req.db.model('Student').findById(studentId);
  if (!student) {
    logger.error('downloadVPDFile: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }

  const app = student.applications.find(
    (application) => application.programId.toString() === program_id
  );
  if (!app) {
    logger.error('downloadVPDFile: Invalid app name!');
    throw new ErrorResponse(404, 'Application not found');
  }
  if (fileType === 'VPD') {
    if (!app.uni_assist.vpd_file_path) {
      logger.error('downloadVPDFile: File not uploaded yet!');
      throw new ErrorResponse(404, 'VPD File not uploaded yet');
    }
  }

  if (fileType === 'VPDConfirmation') {
    if (!app.uni_assist.vpd_paid_confirmation_file_path) {
      logger.error('downloadVPDConfirmationFile: File not uploaded yet!');
      throw new ErrorResponse(404, 'VPD Confirmation File not uploaded yet');
    }
  }
  let document_split = '';
  if (fileType === 'VPD') {
    document_split = app.uni_assist.vpd_file_path.replace(/\\/g, '/');
  }
  if (fileType === 'VPDConfirmation') {
    document_split = app.uni_assist.vpd_paid_confirmation_file_path.replace(
      /\\/g,
      '/'
    );
  }
  document_split = document_split.split('/');

  const [directory, fileName] = document_split;
  const fileKey = path.join(directory, fileName).replace(/\\/g, '/');

  logger.info(`Trying to download ${fileType} file`);
  const value = one_month_cache.get(fileKey); // vpd name
  const encodedFileName = encodeURIComponent(fileName);
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);

    const success = one_month_cache.set(fileKey, Buffer.from(response));
    if (success) {
      logger.info('VPD file cache set successfully');
    }
    res.attachment(encodedFileName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFileName}`
    );
    res.end(response);
    next();
  } else {
    logger.info('VPD file cache hit');
    res.attachment(encodedFileName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFileName}`
    );
    res.end(value);
    next();
  }
});

const downloadProfileFileURL = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, file_key }
  } = req;

  // AWS S3
  // download the file via aws s3 here
  const student = await req.db.model('Student').findById(studentId);

  if (!student) {
    logger.error('downloadProfileFileURL: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }

  const document = student.profile.find((profile) =>
    profile.path.includes(file_key)
  );
  if (!document) {
    logger.error('downloadProfileFileURL: Invalid document name!');
    throw new ErrorResponse(404, 'Document not found');
  }
  if (!document.path) {
    logger.error('downloadProfileFileURL: File not uploaded yet!');
    throw new ErrorResponse(404, 'File not found');
  }

  let document_split = document.path.replace(/\\/g, '/');
  document_split = document_split.split('/');
  const [directory, fileName] = document_split;
  const fileKey = path.join(directory, fileName).replace(/\\/g, '/');
  logger.info(`Trying to download profile file ${fileKey}`);

  const cache_key = `${studentId}${fileKey}`;
  const value = one_month_cache.get(cache_key); // profile name
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const success = one_month_cache.set(cache_key, Buffer.from(response));
    if (success) {
      logger.info('Profile file cache set successfully');
    }
    res.attachment(fileKey);
    res.end(response);
    next();
  } else {
    logger.info('Profile file cache hit');
    res.attachment(fileKey);
    res.end(value);
    next();
  }
});

// (O) email : student notification
const updateProfileDocumentStatus = asyncHandler(async (req, res, next) => {
  const { studentId, category } = req.params;
  const { status, feedback } = req.body;

  if (!Object.values(DocumentStatusType).includes(status)) {
    logger.error('updateProfileDocumentStatus: Invalid document status');
    throw new ErrorResponse(403, 'Invalid document status');
  }

  const student = await req.db
    .model('Student')
    .findOne({
      _id: studentId
    })
    .populate('applications.programId')
    .populate('agents editors', 'firstname lastname email');
  if (!student) {
    logger.error(
      `updateProfileDocumentStatus: Invalid student Id ${studentId}`
    );
    throw new ErrorResponse(404, 'Invalid student Id');
  }
  let document = student.profile.find(({ name }) => name === category);
  try {
    if (!document) {
      document = student.profile.create({ name: category });
      document.status = DocumentStatusType.NotNeeded;
      document.feedback = feedback;
      document.required = true;
      document.updatedAt = new Date();
      document.path = '';
      student.profile.push(document);
      await student.save();
      res.status(201).send({ success: true, data: document });
    } else {
      if (status === DocumentStatusType.Rejected) {
        // rejected file notification set
        student.notification.isRead_base_documents_rejected = false;
        document.feedback = feedback;
      }
      if (status === DocumentStatusType.Accepted) {
        document.feedback = '';
      }

      document.status = status;
      document.updatedAt = new Date();

      await student.save();
      res.status(201).send({ success: true, data: document });
      // Reminder for Student:
      if (isNotArchiv(student)) {
        if (
          status !== DocumentStatusType.NotNeeded &&
          status !== DocumentStatusType.Missing
        ) {
          await sendChangedProfileFileStatusEmail(
            {
              firstname: student.firstname,
              lastname: student.lastname,
              address: student.email
            },
            {
              message: feedback,
              status,
              category: category.replace(/_/g, ' ')
            }
          );
        }
      }
    }
    next();
  } catch (err) {
    logger.error('updateProfileDocumentStatus: ', err);
  }
});

// () TODO: notification student email works includding tasks if decided
// (O) notification agent email works
// () TODO: notification editor email works includding tasks if decided
const UpdateStudentApplications = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: { applications, applying_program_count }
  } = req;
  // retrieve studentId differently depend on if student or Admin/Agent uploading the file
  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId')
    .populate('applications', 'doc_modification_thread.doc_thread_id');

  let new_task_flag = false;
  if (!student) {
    logger.error('UpdateStudentApplications: Invalid student id');
    throw new ErrorResponse(404, 'Invalid student id');
  }
  const new_app_decided_idx = [];
  for (let i = 0; i < applications.length; i += 1) {
    const application_idx = student.applications.findIndex(
      (app) => app._id == applications[i]._id
    );
    const application = student.applications.find(
      (app) => app._id == applications[i]._id
    );
    if (!application) {
      logger.error('UpdateStudentApplications: Invalid document status');
      throw new ErrorResponse(
        404,
        'Invalid application. Please refresh the page and try updating again.'
      );
    }
    if (
      isProgramDecided(applications[i]) &&
      application.decided !== applications[i].decided
    ) {
      // if applications[i].decided === 'yes', send ML/RL/Essay Tasks link in Email for eidtor, student
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
    // TODO: any faster way to query one time and write back once?!
    if (isProgramSubmitted(application)) {
      for (let k = 0; k < application.doc_modification_thread.length; k += 1) {
        application.doc_modification_thread[k].updatedAt = new Date();
        const document_thread = await req.db
          .model('Documentthread')
          .findById(application.doc_modification_thread[k].doc_thread_id);
        document_thread.isFinalVersion = true;
        document_thread.updatedAt = new Date();
        await document_thread.save();
      }
    }
    application.admission = applications[i].admission;
    application.finalEnrolment = applications[i].finalEnrolment;
  }
  if (user.role === Role.Admin) {
    student.applying_program_count = parseInt(applying_program_count);
  }
  await student.save();

  const student_updated = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId')
    .populate(
      'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
      '-messages'
    )
    .populate('agents editors', 'firstname lastname email archiv')
    .select('-profile -notification -application_preference')
    .lean();

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
            new_app_decided_idx: new_app_decided_idx
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
                new_app_decided_idx: new_app_decided_idx
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
                new_app_decided_idx: new_app_decided_idx
              }
            );
          }
        }
      }
    }
  }
  next();
});

const updateStudentApplicationResultV2 = asyncHandler(
  async (req, res, next) => {
    const { studentId, programId } = req.params;
    const { user } = req;
    const { admission, closed } = req.body;

    const student = await req.db
      .model('Student')
      .findById(studentId)
      .populate('agents editors', 'firstname lastname email')
      .populate('applications.programId');
    if (!student) {
      logger.error('updateStudentApplicationResult: Invalid student Id');
      throw new ErrorResponse(404, 'Invalid student Id');
    }

    let updatedStudent;
    if (closed) {
      updatedStudent = await req.db.model('Student').findOneAndUpdate(
        { _id: studentId, 'applications.programId': programId },
        {
          'applications.$.closed': closed
        },
        { new: true }
      );
    }
    if (admission) {
      if (req.file) {
        const admission_letter_temp = {
          status: DocumentStatusType.Uploaded,
          admission_file_path: req.file.key,
          comments: '',
          updatedAt: new Date()
        };

        updatedStudent = await req.db.model('Student').findOneAndUpdate(
          { _id: studentId, 'applications.programId': programId },
          {
            'applications.$.admission': admission,
            'applications.$.admission_letter': admission_letter_temp
          },
          { new: true }
        );
      } else if (admission === '-') {
        const app = student.applications.find(
          (application) => application.programId?._id.toString() === programId
        );
        const file_path = app.admission_letter?.admission_file_path;
        if (file_path && file_path !== '') {
          const fileKey = file_path.replace(/\\/g, '/');
          logger.info('Trying to delete file', fileKey);
          try {
            await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
            const value = two_month_cache.del(fileKey);
            if (value === 1) {
              logger.info('Admission cache key deleted successfully');
            }
          } catch (err) {
            if (err) {
              logger.error(`Error: delete Application result letter: ${err}`);
              throw new ErrorResponse(
                500,
                'Error occurs while deleting Application result letter'
              );
            }
          }
        }
        const admission_letter_temp = {
          status: '',
          admission_file_path: '',
          comments: '',
          updatedAt: new Date()
        };
        updatedStudent = await req.db.model('Student').findOneAndUpdate(
          { _id: studentId, 'applications.programId': programId },
          {
            'applications.$.admission': admission,
            'applications.$.admission_letter': admission_letter_temp
          },
          { new: true }
        );
      } else {
        updatedStudent = await req.db.model('Student').findOneAndUpdate(
          { _id: studentId, 'applications.programId': programId },
          {
            'applications.$.admission': admission
          },
          { new: true }
        );
      }
    }
    const udpatedApplication = updatedStudent.applications.find(
      (application) => application.programId.toString() === programId
    );
    const udpatedApplicationForEmail = student.applications.find(
      (application) => application.programId?.id.toString() === programId
    );
    res.status(200).send({ success: true, data: udpatedApplication });
    if (admission) {
      if (is_TaiGer_Student(user)) {
        if (admission !== '-') {
          for (let i = 0; i < student.agents?.length; i += 1) {
            if (isNotArchiv(student.agents[i])) {
              await AdmissionResultInformEmailToTaiGer(
                {
                  firstname: student.agents[i].firstname,
                  lastname: student.agents[i].lastname,
                  address: student.agents[i].email
                },
                {
                  student_id: student._id.toString(),
                  student_firstname: student.firstname,
                  student_lastname: student.lastname,
                  udpatedApplication: udpatedApplicationForEmail,
                  admission
                }
              );
            }
          }
          for (let i = 0; i < student.editors?.length; i += 1) {
            if (isNotArchiv(student.editors[i])) {
              await AdmissionResultInformEmailToTaiGer(
                {
                  firstname: student.editors[i].firstname,
                  lastname: student.editors[i].lastname,
                  address: student.editors[i].email
                },
                {
                  student_id: student._id.toString(),
                  student_firstname: student.firstname,
                  student_lastname: student.lastname,
                  udpatedApplication: udpatedApplicationForEmail,
                  admission
                }
              );
            }
          }
          logger.info(
            'admission or rejection inform email sent to agents and editors'
          );
        }
      }
    }
    next();
  }
);

const updateStudentApplicationResult = asyncHandler(async (req, res, next) => {
  const { studentId, programId, result } = req.params;
  const { user } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('agents editors', 'firstname lastname email')
    .populate('applications.programId');
  if (!student) {
    logger.error('updateStudentApplicationResult: Invalid student Id');
    throw new ErrorResponse(404, 'Invalid student Id');
  }

  let updatedStudent;
  if (req.file) {
    const admission_letter_temp = {
      status: DocumentStatusType.Uploaded,
      admission_file_path: req.file.key,
      comments: '',
      updatedAt: new Date()
    };

    updatedStudent = await req.db.model('Student').findOneAndUpdate(
      { _id: studentId, 'applications.programId': programId },
      {
        'applications.$.admission': result,
        'applications.$.admission_letter': admission_letter_temp
      },
      { new: true }
    );
  } else if (result === '-') {
    const app = student.applications.find(
      (application) => application.programId?._id.toString() === programId
    );
    const file_path = app.admission_letter?.admission_file_path;
    if (file_path && file_path !== '') {
      const fileKey = file_path.replace(/\\/g, '/');
      logger.info('Trying to delete file', fileKey);
      try {
        await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
        const value = two_month_cache.del(fileKey);
        if (value === 1) {
          logger.info('Admission cache key deleted successfully');
        }
      } catch (err) {
        if (err) {
          logger.error(`Error: delete Application result letter: ${err}`);
          throw new ErrorResponse(
            500,
            'Error occurs while deleting Application result letter'
          );
        }
      }
    }
    const admission_letter_temp = {
      status: '',
      admission_file_path: '',
      comments: '',
      updatedAt: new Date()
    };
    updatedStudent = await req.db.model('Student').findOneAndUpdate(
      { _id: studentId, 'applications.programId': programId },
      {
        'applications.$.admission': result,
        'applications.$.admission_letter': admission_letter_temp
      },
      { new: true }
    );
  } else {
    updatedStudent = await req.db.model('Student').findOneAndUpdate(
      { _id: studentId, 'applications.programId': programId },
      {
        'applications.$.admission': result
      },
      { new: true }
    );
  }

  const udpatedApplication = updatedStudent.applications.find(
    (application) => application.programId.toString() === programId
  );
  const udpatedApplicationForEmail = student.applications.find(
    (application) => application.programId?.id.toString() === programId
  );
  res.status(200).send({ success: true, data: udpatedApplication });
  if (is_TaiGer_Student(user)) {
    if (result !== '-') {
      for (let i = 0; i < student.agents?.length; i += 1) {
        if (isNotArchiv(student.agents[i])) {
          await AdmissionResultInformEmailToTaiGer(
            {
              firstname: student.agents[i].firstname,
              lastname: student.agents[i].lastname,
              address: student.agents[i].email
            },
            {
              student_id: student._id.toString(),
              student_firstname: student.firstname,
              student_lastname: student.lastname,
              udpatedApplication: udpatedApplicationForEmail,
              result
            }
          );
        }
      }
      for (let i = 0; i < student.editors?.length; i += 1) {
        if (isNotArchiv(student.editors[i])) {
          await AdmissionResultInformEmailToTaiGer(
            {
              firstname: student.editors[i].firstname,
              lastname: student.editors[i].lastname,
              address: student.editors[i].email
            },
            {
              student_id: student._id.toString(),
              student_firstname: student.firstname,
              student_lastname: student.lastname,
              udpatedApplication: udpatedApplicationForEmail,
              result
            }
          );
        }
      }
      logger.info(
        'admission or rejection inform email sent to agents and editors'
      );
    }
  }
  next();
});

const deleteProfileFile = asyncHandler(async (req, res, next) => {
  const { studentId, category } = req.params;

  const student = await req.db.model('Student').findOne({
    _id: studentId
  });

  if (!student) {
    logger.error(`deleteProfileFile: Student Id not found ${studentId}`);
    throw new ErrorResponse(404, 'Student Id not found');
  }

  const document = student.profile.find(({ name }) => name === category);
  if (!document) {
    logger.error('deleteProfileFile: Invalid document name');
    throw new ErrorResponse(404, 'Document name not found');
  }
  if (!document.path) {
    logger.error('deleteProfileFile: File not exist');
    throw new ErrorResponse(404, 'Document File not found');
  }

  const fileKey = document.path.replace(/\\/g, '/');

  logger.info('Trying to delete file', fileKey);

  const cache_key = `${studentId}${fileKey}`;
  try {
    await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
    document.status = DocumentStatusType.Missing;
    document.path = '';
    document.updatedAt = new Date();

    student.save();
    const value = one_month_cache.del(cache_key);
    if (value === 1) {
      logger.info('Profile cache key deleted successfully');
    }
    res.status(200).send({ success: true, data: document });
    next();
  } catch (err) {
    if (err) {
      logger.error('deleteProfileFile: ', err);
      throw new ErrorResponse(500, 'Error occurs while deleting');
    }
  }
});

const deleteVPDFile = asyncHandler(async (req, res, next) => {
  const { studentId, program_id, fileType } = req.params;

  const student = await req.db
    .model('Student')
    .findOne({
      _id: studentId
    })
    .populate('applications.programId')
    .populate('agents editors', 'firstname lastname email');

  if (!student) {
    logger.error(`deleteVPDFile: Invalid student Id ${studentId}`);
    throw new ErrorResponse(404, 'Invalid student Id');
  }

  const app = student.applications.find(
    (application) => application.programId._id.toString() === program_id
  );
  if (!app) {
    logger.error('deleteVPDFile: Invalid applications name');
    throw new ErrorResponse(404, 'Applications name not found');
  }
  if (fileType === 'VPD') {
    if (!app.uni_assist.vpd_file_path) {
      logger.error('deleteVPDFile: VPD File not exist');
      throw new ErrorResponse(404, 'VPD File not exist');
    }
  }
  if (fileType === 'VPDConfirmation') {
    if (!app.uni_assist.vpd_paid_confirmation_file_path) {
      logger.error(
        'deleteVPDConfirmationFile: VPD Confirmation File not exist'
      );
      throw new ErrorResponse(404, 'VPD Confirmation File not exist');
    }
  }
  let document_split = '';
  if (fileType === 'VPD') {
    document_split = app.uni_assist.vpd_file_path.replace(/\\/g, '/');
  }
  if (fileType === 'VPDConfirmation') {
    document_split = app.uni_assist.vpd_paid_confirmation_file_path.replace(
      /\\/g,
      '/'
    );
  }

  const fileKey = document_split.replace(/\\/g, '/');
  logger.info(`Trying to delete file ${fileKey}`);

  try {
    await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const value = one_month_cache.del(fileKey);
    if (value === 1) {
      logger.info('VPD cache key deleted successfully');
    }
    if (fileType === 'VPD') {
      app.uni_assist.status = DocumentStatusType.Missing;
      app.uni_assist.vpd_file_path = '';
    }
    if (fileType === 'VPDConfirmation') {
      app.uni_assist.vpd_paid_confirmation_file_path = '';
    }
    app.uni_assist.updatedAt = new Date();
    student.save();
    const updatedApplication = student.applications.find(
      (application) => application.programId._id.toString() === program_id
    );
    res.status(200).send({ success: true, data: updatedApplication });
    next();
  } catch (err) {
    if (err) {
      logger.error('deleteVPDFile: ', err);
      throw new ErrorResponse(500, 'Error occurs while deleting');
    }
  }
});

const removeNotification = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const { notification_key } = req.body;
  // eslint-disable-next-line no-underscore-dangle
  const me = await req.db.model('User').findById(user._id.toString());
  const obj = me.notification; // create object
  obj[`${notification_key}`] = true; // set value
  await req.db
    .model('User')
    .findByIdAndUpdate(user._id.toString(), { notification: obj }, {});
  res.status(200).send({
    success: true
  });
  next();
});

const removeAgentNotification = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const { notification_key, student_id } = req.body;
  // eslint-disable-next-line no-underscore-dangle
  const me = await req.db.model('Agent').findById(user._id.toString());
  const idx = me.agent_notification[`${notification_key}`].findIndex(
    (student_obj) => student_obj.student_id === student_id
  );
  if (idx === -1) {
    logger.error('removeAgentNotification: student id not existed');
    throw new ErrorResponse(403, 'student id not existed');
  }
  me.agent_notification[`${notification_key}`].splice(idx, 1);
  await me.save();
  res.status(200).send({
    success: true
  });
  next();
});

const getMyAcademicBackground = asyncHandler(async (req, res, next) => {
  const { user: student } = req;
  const { _id } = student;
  const me = await req.db.model('User').findById(_id);
  if (me.academic_background === undefined) me.academic_background = {};
  await me.save();
  // TODO: mix with base-docuement link??
  const survey_docs_link = await req.db.model('Basedocumentationslink').find({
    category: 'survey'
  });

  res.status(200).send({
    success: true,
    data: {
      agents: me.agents,
      editors: me.editors,
      academic_background: me.academic_background,
      application_preference: me.application_preference
    },
    survey_link: survey_docs_link
  });
  next();
});

module.exports = {
  getTemplates,
  deleteTemplate,
  uploadTemplate,
  saveProfileFilePath,
  saveVPDFilePath,
  downloadVPDFile,
  downloadProfileFileURL,
  downloadTemplateFile,
  updateProfileDocumentStatus,
  UpdateStudentApplications,
  updateStudentApplicationResultV2,
  updateStudentApplicationResult,
  deleteProfileFile,
  updateVPDPayment,
  updateVPDFileNecessity,
  deleteVPDFile,
  removeNotification,
  removeAgentNotification,
  getMyAcademicBackground
};
