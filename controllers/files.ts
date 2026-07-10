import path from 'path';
import { Types } from 'mongoose';
import { is_TaiGer_Student } from '@taiger-common/core';
import { DocumentStatusType, IUser } from '@taiger-common/model';
import { Request, Response, NextFunction } from 'express';

import { asyncHandler } from '../middlewares/error-handler';
import { ten_minutes_cache } from '../cache/node-cache';
import { ErrorResponse } from '../common/errors';
import { isNotArchiv } from '../constants';
import {
  deleteTemplateSuccessEmail,
  sendAgentUploadedProfileFilesForStudentEmail,
  sendAgentUploadedVPDForStudentEmail,
  sendUploadedProfileFilesRemindForAgentEmail,
  sendUploadedVPDRemindForAgentEmail,
  sendChangedProfileFileStatusEmail,
  AdmissionResultInformEmailToTaiGer
} from '../services/email';
import { sendSlackMessageToWinChannel } from '../utils/slackUtils';
import { AWS_S3_BUCKET_NAME, AWS_S3_PUBLIC_BUCKET_NAME } from '../config';
import logger from '../services/logger';

import { deleteS3Object, getS3Object } from '../aws/s3';
import ApplicationService from '../services/applications';
import TemplateService from '../services/templates';
import StudentService from '../services/students';
import UserService from '../services/users';
import BasedocumentationslinkService from '../services/basedocumentationslinks';

// req.user is attached by the auth middleware as a Mongoose user/student/agent
// doc, but the ambient Express.User type (from @types/passport, pulled in via
// middlewares/passport.ts) is an empty interface, which collides with our own
// `user?: any` augmentation (types/express.d.ts) and widens req.user to `{}`.
// Model the real runtime shape here instead: the domain IUser fields plus the
// Mongoose-assigned `_id` (not part of IUser itself).
type AuthUser = IUser & { _id: Types.ObjectId };

// req.file is populated by the multer-s3 storage engine, but @types/multer-s3
// models its extra fields (e.g. `key`) on a separate `Express.MulterS3.File`
// interface rather than merging them into `Express.Multer.File`.
type UploadedFile = Express.MulterS3.File;

const getTemplates = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const templates = await TemplateService.getTemplates();

    res.status(201).send({ success: true, data: templates });
    next();
  }
);

// (O) email admin delete template
const deleteTemplate = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as AuthUser;
    const category_name = String(req.params.category_name);

    const template = await TemplateService.getTemplateByCategory(category_name);

    const document_path = template!.path.replace(/\\/g, '/');
    const document_split = document_path.split('/');
    const [directory, fileName] = document_split;
    const fileKey = path.join(directory, fileName).replace(/\\/g, '/');
    logger.info('Trying to delete file', { fileKey });

    try {
      await deleteS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
    } catch (err) {
      if (err) {
        logger.error('deleteTemplate: ', { err });
        throw new ErrorResponse(500, 'Error occurs while deleting');
      }
    }
    await TemplateService.deleteTemplateByCategory(category_name);
    const templates = await TemplateService.getTemplates();
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
  }
);

// (O) email admin uploaded template successfully
const uploadTemplate = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const category_name = String(req.params.category_name);
    const file = req.file as UploadedFile;

    const updated_templates = await TemplateService.upsertTemplate(
      category_name,
      {
        name: file.key,
        category_name,
        path: file.key,
        updatedAt: new Date()
      }
    );
    res.status(201).send({ success: true, data: updated_templates });
    next();
  }
);

const downloadTemplateFile = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const category_name = String(req.params.category_name);

    const template = await TemplateService.getTemplateByCategory(category_name);
    // AWS S3
    // download the file via aws s3 here
    const document_path = template!.path.replace(/\\/g, '/');
    const document_split = document_path.split('/');
    const [directory, fileName] = document_split;
    const fileKey = path.join(directory, fileName).replace(/\\/g, '/');
    logger.info('Trying to download template file', { fileKey });

    const value = ten_minutes_cache.get(fileKey); // vpd name
    if (value === undefined) {
      const response = await getS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
      const success = ten_minutes_cache.set(
        fileKey,
        Buffer.from(response as Uint8Array)
      );
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
  }
);

// (O) email : student notification
// (O) email : agent notification
const saveProfileFilePath = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const user = req.user as AuthUser;
    const studentId = String(req.params.studentId);
    const category = String(req.params.category);
    // retrieve studentId differently depend on if student or Admin/Agent uploading the file
    const student = await StudentService.getStudentDocByIdPopulated(studentId, [
      ['agents editors', 'firstname lastname email archiv']
    ]);
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
      document.path = (req.file as UploadedFile).key;
      student.profile.push(document);
      await student.save();
      res.status(201).send({ success: true, data: document });
      if (is_TaiGer_Student(user)) {
        // TODO: add notification for agents
        for (let i = 0; i < student.agents.length; i += 1) {
          const agent = await UserService.getAgentDocById(
            student.agents[i]._id.toString()
          );
          if (!agent) {
            logger.error(
              `saveProfileFilePath: agent not found ${student.agents[
                i
              ]._id.toString()}`
            );
            continue;
          }
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
          // agents are populated user docs at runtime (typed loosely here).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agentDoc = student.agents[i] as any;
          if (isNotArchiv(agentDoc)) {
            await sendUploadedProfileFilesRemindForAgentEmail(
              {
                firstname: agentDoc.firstname,
                lastname: agentDoc.lastname,
                address: agentDoc.email
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
      } else if (isNotArchiv(student as unknown as IUser)) {
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
      document.path = (req.file as UploadedFile).key;
      await student.save();

      // retrieve studentId differently depend on if student or Admin/Agent uploading the file
      res.status(201).send({ success: true, data: document });
      if (is_TaiGer_Student(user)) {
        // TODO: notify agents
        for (let i = 0; i < student.agents.length; i += 1) {
          const agent = await UserService.getAgentDocById(
            student.agents[i]._id.toString()
          );
          if (!agent) {
            logger.error(
              `saveProfileFilePath: agent not found ${student.agents[
                i
              ]._id.toString()}`
            );
            continue;
          }
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agentDoc = student.agents[i] as any;
          if (isNotArchiv(agentDoc)) {
            await sendUploadedProfileFilesRemindForAgentEmail(
              {
                firstname: agentDoc.firstname,
                lastname: agentDoc.lastname,
                address: agentDoc.email
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
      } else if (isNotArchiv(student as unknown as IUser)) {
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
  }
);

const updateVPDPayment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const applicationId = String(req.params.applicationId);
    const { isPaid } = req.body;

    const app = await ApplicationService.getApplicationById(applicationId);
    if (!app) {
      logger.error('updateVPDPayment: Invalid program id!');
      throw new ErrorResponse(404, 'Application not found');
    }

    const updatedApp = await ApplicationService.updateApplication(
      { _id: applicationId },
      { uni_assist: { ...app.uni_assist, isPaid, updatedAt: new Date() } }
    );

    res.status(201).send({ success: true, data: updatedApp });
  }
);
// () email:

const updateVPDFileNecessity = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const applicationId = String(req.params.applicationId);

    const app = await ApplicationService.getApplicationById(applicationId);

    if (!app) {
      logger.error('updateVPDFileNecessity: Invalid program id!');
      throw new ErrorResponse(404, 'Application not found');
    }
    // TODO: set bot notneeded and resume needed
    let status = DocumentStatusType.NotNeeded;
    if (app.uni_assist.status === DocumentStatusType.NotNeeded) {
      status = DocumentStatusType.Missing;
    }

    const updatedApp = await ApplicationService.updateApplication(
      { _id: applicationId },
      {
        uni_assist: {
          ...app.uni_assist,
          status,
          updatedAt: new Date()
        }
      }
    );

    res.status(201).send({ success: true, data: updatedApp });
  }
);

// (O) email : student notification
// (O) email : agent notification
const saveVPDFilePath = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const user = req.user as AuthUser;
    const studentId = String(req.params.studentId);
    const applicationId = String(req.params.applicationId);
    const fileType = String(req.params.fileType);
    const file = req.file as UploadedFile;

    const app = await ApplicationService.getApplicationDocByIdWithProgram(
      applicationId
    );

    if (!app) {
      logger.error('saveVPDFilePath: Invalid application id!');
      throw new ErrorResponse(404, 'Application not found');
    }
    if (fileType === 'VPD') {
      app.uni_assist.status = DocumentStatusType.Uploaded;
      app.uni_assist.updatedAt = new Date();
      app.uni_assist.vpd_file_path = file.key;
    }
    if (fileType === 'VPDConfirmation') {
      // app.uni_assist.status = DocumentStatusType.Uploaded;
      app.uni_assist.updatedAt = new Date();
      app.uni_assist.vpd_paid_confirmation_file_path = file.key;
    }

    await app.save();

    // retrieve studentId differently depend on if student or Admin/Agent uploading the file
    res.status(201).send({ success: true, data: app });

    const student_updated = await StudentService.getStudentByIdPopulated(
      studentId,
      [['agents', 'firstname lastname email archiv']]
    );
    if (!student_updated) {
      logger.error(`saveVPDFilePath: student not found ${studentId}`);
      return;
    }

    if (is_TaiGer_Student(user)) {
      // Reminder for Agent:
      for (let i = 0; i < student_updated.agents.length; i += 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agentDoc = student_updated.agents[i] as any;
        if (isNotArchiv(agentDoc)) {
          await sendUploadedVPDRemindForAgentEmail(
            {
              firstname: agentDoc.firstname,
              lastname: agentDoc.lastname,
              address: agentDoc.email
            },
            {
              student_firstname: student_updated.firstname,
              student_lastname: student_updated.lastname,
              student_id: student_updated._id.toString(),
              fileType,
              uploaded_documentname: file.key.replace(/_/g, ' '),
              uploaded_updatedAt: app.uni_assist.updatedAt
            }
          );
        }
      }
    } else if (isNotArchiv(student_updated as unknown as IUser)) {
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
          uploaded_documentname: file.key.replace(/_/g, ' '),
          uploaded_updatedAt: app.uni_assist.updatedAt
        }
      );
    }
  }
);

const downloadVPDFile = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { fileType } = req.params;
    const applicationId = String(req.params.applicationId);

    // AWS S3
    // download the file via aws s3 here
    const app = await ApplicationService.getApplicationDocByIdWithProgram(
      applicationId
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
    let document_path = '';
    if (fileType === 'VPD') {
      document_path = app.uni_assist.vpd_file_path.replace(/\\/g, '/');
    }
    if (fileType === 'VPDConfirmation') {
      document_path = app.uni_assist.vpd_paid_confirmation_file_path.replace(
        /\\/g,
        '/'
      );
    }
    const document_split = document_path.split('/');

    const [directory, fileName] = document_split;
    const fileKey = path.join(directory, fileName).replace(/\\/g, '/');

    logger.info(`Trying to download ${fileType} file`);
    const encodedFileName = encodeURIComponent(fileName);
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);

    res.attachment(encodedFileName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFileName}`
    );
    res.end(response);
  }
);

const downloadProfileFileURL = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const studentId = String(req.params.studentId);
    const file_key = String(req.params.file_key);

    // AWS S3
    // download the file via aws s3 here
    const student = await StudentService.getStudentDocById(studentId);

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

    const document_path = document.path.replace(/\\/g, '/');
    const document_split = document_path.split('/');
    const [directory, fileName] = document_split;
    const fileKey = path.join(directory, fileName).replace(/\\/g, '/');
    logger.info(`Trying to download profile file ${fileKey}`);

    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);

    res.attachment(fileKey);
    res.end(response);
  }
);

// (O) email : student notification
const updateProfileDocumentStatus = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const studentId = String(req.params.studentId);
    const category = String(req.params.category);
    const { status, feedback } = req.body;

    if (!Object.values(DocumentStatusType).includes(status)) {
      logger.error('updateProfileDocumentStatus: Invalid document status');
      throw new ErrorResponse(403, 'Invalid document status');
    }

    const student = await StudentService.getStudentDocByIdPopulated(studentId, [
      ['agents editors', 'firstname lastname email']
    ]);
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
          if (student.notification) {
            student.notification.isRead_base_documents_rejected = false;
          }
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
        if (isNotArchiv(student as unknown as IUser)) {
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
    } catch (err) {
      logger.error('updateProfileDocumentStatus: ', { err });
    }
  }
);

// TODO: not used yet.
const updateStudentApplicationResultV2 = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const studentId = String(req.params.studentId);
    const programId = String(req.params.programId);
    const user = req.user as AuthUser;
    const { admission, closed } = req.body;

    const studentDoc = await StudentService.getStudentDocByIdPopulated(
      studentId,
      [
        ['agents editors', 'firstname lastname email'],
        ['applications.programId']
      ]
    );
    if (!studentDoc) {
      logger.error('updateStudentApplicationResultV2: Invalid student Id');
      throw new ErrorResponse(404, 'Invalid student Id');
    }
    // Populated doc with dynamic applications/agents/editors access.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const student = studentDoc as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updatedStudent: any;
    if (closed) {
      updatedStudent = await StudentService.updateStudentByFilter(
        { _id: studentId, 'applications.programId': programId },
        {
          'applications.$.closed': closed
        }
      );
    }
    if (admission) {
      if (req.file) {
        const admission_letter_temp = {
          status: DocumentStatusType.Uploaded,
          admission_file_path: (req.file as UploadedFile).key,
          comments: '',
          updatedAt: new Date()
        };

        updatedStudent = await StudentService.updateStudentByFilter(
          { _id: studentId, 'applications.programId': programId },
          {
            'applications.$.admission': admission,
            'applications.$.admission_letter': admission_letter_temp
          }
        );
      } else if (admission === '-') {
        const app = student.applications.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (application: any) =>
            application.programId?._id.toString() === programId
        );
        const file_path = app.admission_letter?.admission_file_path;
        if (file_path && file_path !== '') {
          const fileKey = file_path.replace(/\\/g, '/');
          logger.info('Trying to delete file', fileKey);
          try {
            await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
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
        updatedStudent = await StudentService.updateStudentByFilter(
          { _id: studentId, 'applications.programId': programId },
          {
            'applications.$.admission': admission,
            'applications.$.admission_letter': admission_letter_temp
          }
        );
      } else {
        updatedStudent = await StudentService.updateStudentByFilter(
          { _id: studentId, 'applications.programId': programId },
          {
            'applications.$.admission': admission
          }
        );
      }
    }
    const udpatedApplication = updatedStudent.applications.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (application: any) => application.programId.toString() === programId
    );
    const udpatedApplicationForEmail = student.applications.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (application: any) => application.programId?.id.toString() === programId
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
  }
);

const updateStudentApplicationResult = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const studentId = String(req.params.studentId);
    const applicationId = String(req.params.applicationId);
    const { result } = req.params;
    const user = req.user as AuthUser;

    let _updatedStudent;
    if (req.file) {
      const admission_letter_temp = {
        status: DocumentStatusType.Uploaded,
        admission_file_path: (req.file as UploadedFile).key,
        comments: '',
        updatedAt: new Date()
      };

      _updatedStudent = await ApplicationService.updateApplication(
        {
          _id: applicationId
        },
        {
          admission: result,
          admission_letter: admission_letter_temp
        }
      );
    } else if (result === '-') {
      const app = await ApplicationService.getApplicationById(applicationId);
      const file_path = app.admission_letter?.admission_file_path;
      if (file_path && file_path !== '') {
        const fileKey = file_path.replace(/\\/g, '/');
        logger.info('Trying to delete file', fileKey);
        try {
          await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
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
      _updatedStudent = await ApplicationService.updateApplication(
        {
          _id: applicationId
        },
        {
          admission: result,
          admission_letter: admission_letter_temp
        }
      );
    } else {
      _updatedStudent = await ApplicationService.updateApplication(
        {
          _id: applicationId
        },
        {
          admission: result
        }
      );
    }

    const udpatedApplication = await ApplicationService.getApplicationById(
      applicationId
    );
    const udpatedApplicationForEmail =
      await ApplicationService.getApplicationById(applicationId);

    res.status(200).send({ success: true, data: udpatedApplication });

    const student = await StudentService.getStudentByIdPopulated(studentId, [
      ['agents editors', 'firstname lastname email slackId archiv']
    ]);
    if (!student) {
      logger.error('updateStudentApplicationResult: Invalid student Id');
      throw new ErrorResponse(404, 'Invalid student Id');
    }

    if (result !== '-') {
      // agents/editors are populated user docs at runtime (typed loosely here).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taigerStaff = ([...student.agents, ...student.editors] as any[])
        .filter((staff) => isNotArchiv(staff))
        .filter((staff) => staff._id !== user._id); // exclude the one who trigger the result update
      for (const staff of taigerStaff) {
        await AdmissionResultInformEmailToTaiGer(
          {
            firstname: staff.firstname,
            lastname: staff.lastname,
            address: staff.email
          },
          {
            student_id: student._id.toString(),
            student_firstname: student.firstname,
            student_lastname: student.lastname,
            udpatedApplication: udpatedApplicationForEmail,
            admission: result
          }
        );
      }
      logger.info(
        'admission or rejection inform email sent to agents and editors'
      );
    }

    // TODO: send notification to slack win!
    if (result === 'O') {
      sendSlackMessageToWinChannel(student, udpatedApplication);
    }

    next();
  }
);

const deleteProfileFile = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const studentId = String(req.params.studentId);
    const category = String(req.params.category);

    const student = await StudentService.getStudentDocById(studentId);

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

    logger.info('Trying to delete file', { fileKey });

    try {
      await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
      document.status = DocumentStatusType.Missing;
      document.path = '';
      document.updatedAt = new Date();

      student.save();

      res.status(200).send({ success: true, data: document });
    } catch (err) {
      if (err) {
        logger.error('deleteProfileFile: ', { err });
        throw new ErrorResponse(500, 'Error occurs while deleting');
      }
    }
  }
);

const deleteVPDFile = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { fileType } = req.params;
    const applicationId = String(req.params.applicationId);

    const app = await ApplicationService.getApplicationDocByIdWithProgram(
      applicationId
    );

    if (!app) {
      logger.error('deleteVPDFile: Invalid application name');
      throw new ErrorResponse(404, 'Application not found');
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

    await deleteS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const payload = {
      uni_assist: {
        ...app.uni_assist,
        updatedAt: new Date()
      }
    };
    if (fileType === 'VPD') {
      payload.uni_assist.status = DocumentStatusType.Missing;
      payload.uni_assist.vpd_file_path = '';
    }
    if (fileType === 'VPDConfirmation') {
      payload.uni_assist.vpd_paid_confirmation_file_path = '';
    }
    const updatedApp = await ApplicationService.updateApplication(
      { _id: applicationId },
      payload
    );

    res.status(200).send({ success: true, data: updatedApp });
  }
);

const removeNotification = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as AuthUser;
    const { notification_key } = req.body;
    // eslint-disable-next-line no-underscore-dangle
    const me = await UserService.getUserDocById(user._id.toString());
    if (!me) {
      logger.error('removeNotification: user not found');
      throw new ErrorResponse(404, 'User not found');
    }
    // notification is a fixed-shape object; the key is provided dynamically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = me.notification as any; // create object
    obj[`${notification_key}`] = true; // set value
    await UserService.updateUser(user._id.toString(), { notification: obj });
    res.status(200).send({
      success: true
    });
    next();
  }
);

const removeAgentNotification = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as AuthUser;
    const { notification_key, student_id } = req.body;
    // eslint-disable-next-line no-underscore-dangle
    const me = await UserService.getAgentDocById(user._id.toString());
    if (!me) {
      logger.error('removeAgentNotification: agent not found');
      throw new ErrorResponse(404, 'Agent not found');
    }
    // agent_notification is a fixed-shape object; the key is provided dynamically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentNotification = me.agent_notification as any;
    const idx = agentNotification[`${notification_key}`].findIndex(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (student_obj: any) => student_obj.student_id === student_id
    );
    if (idx === -1) {
      logger.error('removeAgentNotification: student id not existed');
      throw new ErrorResponse(403, 'student id not existed');
    }
    agentNotification[`${notification_key}`].splice(idx, 1);
    await me.save();
    res.status(200).send({
      success: true
    });
    next();
  }
);

const getMyAcademicBackground = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const student = req.user as AuthUser;
    const { _id } = student;
    const meDoc = await UserService.getUserDocById(_id.toString());
    if (!meDoc) {
      logger.error('getMyAcademicBackground: user not found');
      throw new ErrorResponse(404, 'User not found');
    }
    // Student doc with academic_background / agents / editors accessed dynamically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me = meDoc as any;
    if (me.academic_background === undefined) me.academic_background = {};
    await me.save();
    // TODO: mix with base-docuement link??
    const survey_docs_link = await BasedocumentationslinkService.findByCategory(
      'survey'
    );

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
  }
);

export = {
  getTemplates,
  deleteTemplate,
  uploadTemplate,
  saveProfileFilePath,
  saveVPDFilePath,
  downloadVPDFile,
  downloadProfileFileURL,
  downloadTemplateFile,
  updateProfileDocumentStatus,
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
