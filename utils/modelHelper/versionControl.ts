import mongoose from 'mongoose';
import path from 'path';
import logger from '../../services/logger';
import { asyncHandler } from '../../middlewares/error-handler';
import { findStudentDelta } from './programChange';
import { ErrorResponse } from '../../common/errors';
import { AWS_S3_BUCKET_NAME } from '../../config';
import { listS3ObjectsV2, deleteS3Objects } from '../../aws/s3';

// TODO: aws-sdk v3 to be tested
// only delete first 1000 objects
const emptyS3Directory = asyncHandler(async (bucket, dir) => {
  const listParams = {
    bucketName: bucket,
    Prefix: dir
  };

  const listedObjects = await listS3ObjectsV2(listParams);
  if (!listedObjects?.Contents || listedObjects.Contents.length === 0) return;

  const deleteParams = {
    Delete: { Objects: [] }
  };

  listedObjects?.Contents?.forEach(({ Key }) => {
    deleteParams.Delete.Objects.push({ Key });
  });
  logger.warn(JSON.stringify(deleteParams));
  if (deleteParams.Delete.Objects.length > 0) {
    await deleteS3Objects({
      bucketName: AWS_S3_BUCKET_NAME,
      objectKeys: deleteParams.Delete.Objects
    });
  }
});

const createApplicationThread = async (studentId, programId, fileType) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
  const { Student, Application, Documentthread } = require('../../models');

  const threadExisted = await Documentthread.findOne({
    student_id: studentId,
    program_id: programId,
    file_type: fileType
  });

  if (threadExisted) {
    logger.error(
      'initApplicationMessagesThread: Document Thread already existed!'
    );
    throw new ErrorResponse(409, 'Document Thread already existed!');
  }
  const student = await Student.findById(studentId);
  const applications = await Application.find({ studentId }).populate(
    'programId'
  );

  if (!applications) {
    logger.info('initApplicationMessagesThread: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }

  const appIdx = applications.findIndex(
    (app) => app.programId._id.toString() === programId.toString()
  );

  if (appIdx === -1) {
    logger.info('initApplicationMessagesThread: Invalid application id!');
    throw new ErrorResponse(404, 'Application not found');
  }

  const newThread = new Documentthread({
    student_id: studentId,
    application_id: applications[appIdx]._id,
    file_type: fileType,
    program_id: programId,
    updatedAt: new Date()
  });

  const newAppRecord = applications[appIdx].doc_modification_thread.create({
    doc_thread_id: newThread,
    updatedAt: new Date(),
    createdAt: new Date()
  });
  applications[appIdx].doc_modification_thread.push(newAppRecord);
  student.notification.isRead_new_cvmlrl_tasks_created = false;
  await student.save();
  await applications[appIdx].save();
  await newThread.save();
  return newAppRecord;
};

// only for initApplicationMessagesThread. The service is single-connection now
// (req.db eliminated), so the sibling models come straight from the central
// default-connection registry — no need for the caller to inject them. Required
// lazily inside the function to avoid the models <-> Program-plugin require cycle
// (models/Program.js pulls this file for its hooks).
const createApplicationThreadV2 = async (
  studentId,
  applicationId,
  fileType
) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
  const { Student, Application, Documentthread } = require('../../models');

  const threadExisted = await Documentthread.findOne({
    student_id: studentId,
    application_id: applicationId,
    file_type: fileType
  });

  if (threadExisted) {
    logger.error(
      'initApplicationMessagesThread: Document Thread already existed!'
    );
    throw new ErrorResponse(409, 'Document Thread already existed!');
  }
  const student = await Student.findById(studentId);
  const applications = await Application.find({ studentId }).populate(
    'programId'
  );

  if (!applications) {
    logger.info('initApplicationMessagesThread: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }

  const appIdx = applications.findIndex(
    (app) => app._id.toString() === applicationId.toString()
  );

  if (appIdx === -1) {
    logger.info('initApplicationMessagesThread: Invalid application id!');
    throw new ErrorResponse(404, 'Application not found');
  }

  const newThread = new Documentthread({
    student_id: studentId,
    application_id: applications[appIdx]._id,
    file_type: fileType,
    program_id: applications[appIdx].programId._id.toString(),
    updatedAt: new Date()
  });

  const newAppRecord = applications[appIdx].doc_modification_thread.create({
    doc_thread_id: newThread,
    updatedAt: new Date(),
    createdAt: new Date()
  });
  applications[appIdx].doc_modification_thread.push(newAppRecord);
  student.notification.isRead_new_cvmlrl_tasks_created = false;
  await student.save();
  await applications[appIdx].save();
  await newThread.save();
  return newAppRecord;
};

const deleteApplicationThread = async (
  studentId,
  programId,
  messagesThreadId
) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
  const { Application, Documentthread, surveyInput } = require('../../models');

  // Before delete the thread, please delete all of the files in the thread!!
  // Delete folder
  let directory = path.join(studentId, messagesThreadId);
  logger.info('Trying to delete message thread and folder');
  directory = directory.replace(/\\/g, '/');
  emptyS3Directory(AWS_S3_BUCKET_NAME, directory);

  await Application.findOneAndUpdate(
    {
      studentId: new mongoose.Types.ObjectId(studentId),
      programId: new mongoose.Types.ObjectId(programId)
    },
    {
      $pull: {
        doc_modification_thread: {
          doc_thread_id: {
            _id: new mongoose.Types.ObjectId(messagesThreadId)
          }
        }
      }
    }
  );
  const thread = await Documentthread.findByIdAndDelete(messagesThreadId);
  await surveyInput.deleteOne({
    studentId,
    programId,
    fileType: thread.file_type
  });
};

const detectChanges = (a, b) => {
  const original = {};
  const changes = {};
  for (const key in { ...a, ...b }) {
    if (['_id', 'updatedAt', 'whoupdated'].includes(key)) {
      continue;
    }
    if (a[key] !== b[key]) {
      original[key] = a[key];
      changes[key] = b[key];
    }
  }
  return {
    originalValues: original,
    updatedValues: changes,
    changedBy: b?.whoupdated
  };
};

const isCrucialChanges = (changes) => {
  const crucialChanges = [
    'ml_required',
    'sop_required',
    'phs_required',
    'rl_required',
    'rl_requirements',
    'is_rl_specific',
    'essay_required',
    'portfolio_required',
    'curriculum_analysis_required',
    'scholarship_form_required',
    'supplementary_form_required'
  ];
  for (const change in changes) {
    if (crucialChanges.includes(change)) {
      return true;
    }
  }
  return false;
};

const findAffectedStudents = asyncHandler(async (programId) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
  const { Application } = require('../../models');
  // non-archived student has open application for program
  const applications = await Application.find({
    programId,
    closed: '-',
    archive: { $ne: true }
  })
    .select('studentId')
    .lean();

  const students = applications.map((app) => app.studentId.toString());
  return students;
});

const handleStudentDelta = asyncHandler(async (studentId, program) => {
  const studentDelta = await findStudentDelta(studentId, program);
  logger.info('studentDelta', { studentDelta });
  for (let missingDoc of studentDelta.add) {
    try {
      await createApplicationThread(
        missingDoc.studentId.toString(),
        missingDoc.programId.toString(),
        missingDoc.fileType
      );
      logger.info(
        `handleStudentDelta: create thread for student ${missingDoc.studentId} and program ${missingDoc.programId} with file type ${missingDoc.fileType}`
      );
    } catch (error) {
      logger.error(
        `handleStudentDelta: error on thread creation for student ${missingDoc.studentId} and program ${missingDoc.programId} with file type ${missingDoc.fileType} -> error: ${error}`
      );
    }
  }
  for (let extraDoc of studentDelta.remove) {
    if (extraDoc?.fileThread?.messageSize !== 0) {
      logger.info(
        `handleStudentDelta: thread deletion aborted (non-empty thread) for student ${studentId} and program ${program._id} with file type ${extraDoc.fileThread.fileType} -> messages exist`
      );
      continue;
    }
    try {
      await deleteApplicationThread(
        extraDoc.studentId.toString(),
        extraDoc.programId.toString(),
        extraDoc.fileThread._id.toString()
      );
      logger.info(
        `handleStudentDelta: delete thread for student ${extraDoc.studentId} and program ${extraDoc.programId} with file type ${extraDoc.fileThread.file_type}`
      );
    } catch (error) {
      logger.error(
        `handleStudentDelta: error on thread deletion for student ${extraDoc.studentId} and program ${extraDoc.programId} with file type ${extraDoc.fileThread.file_type} -> error: ${error}`
      );
    }
  }
});

const handleThreadDelta = asyncHandler(async (program) => {
  const affectedStudents = await findAffectedStudents(program._id);
  for (let studentId of affectedStudents) {
    try {
      await handleStudentDelta(studentId, program);
    } catch (error) {
      logger.error(
        `handleThreadDelta: error on student ${studentId} and program ${program._id}: ${error}`
      );
    }
  }
});

// The thread-delta helpers below pull the central default-connection models
// themselves (the service is single-connection now), so the hook only needs to
// detect crucial changes and forward the updated program docs.
const handleProgramChanges = (schema) => {
  schema.pre(
    ['findOneAndUpdate', 'updateOne', 'updateMany', 'update'],
    async function (_doc) {
      try {
        const condition = this.getQuery();
        this._originals = await this.model.find(condition).lean();
      } catch (error) {
        logger.error(`ProgramHook - Error on pre hook: ${error}`);
      }
    }
  );

  schema.post(
    ['findOneAndUpdate', 'updateOne', 'updateMany', 'update'],
    async function (_doc) {
      try {
        const docs = this._originals;
        delete this._originals;
        const changes = this.getUpdate().$set;
        if (!isCrucialChanges(changes) || docs?.length === 0) {
          return;
        }

        for (const doc of docs) {
          const updatedDoc = { ...doc, ...changes };
          const programId = updatedDoc._id;

          try {
            logger.info(
              `ProgramHook - Crucial changes detected on Program (Id=${programId}): ${JSON.stringify(
                changes
              )}`
            );
            await handleThreadDelta(updatedDoc);
            logger.info(
              `ProgramHook - Post hook executed successfully. (Id=${programId})`
            );
          } catch (error) {
            logger.error(
              `ProgramHook - Error on post hook (Id=${programId}): ${error}`
            );
          }
        }
      } catch (error) {
        logger.error(`ProgramHook - Error on post hook: ${error}`);
      }
    }
  );
};

// VCModel is resolved from the connection of the model that fired the hook
// (`this.model.db`), so version control works on every connection the schema is
// compiled on (default + per-request).
const enableVersionControl = (schema) => {
  schema.pre(
    ['findOneAndUpdate', 'updateOne', 'updateMany', 'update'],
    async function () {
      const collectionName = this.model.modelName;
      try {
        const condition = this.getQuery();
        this._oldVersion = await this.model.find(condition).lean();
        this._changeRequestId = this.getUpdate()?.changeRequestId;
      } catch (error) {
        logger.error(`VC (${collectionName}) - Error on pre hook: ${error}`);
      }
    }
  );

  schema.post(
    ['findOneAndUpdate', 'updateOne', 'updateMany', 'update'],
    async function () {
      const collectionName = this.model.modelName;
      const VCModel = this.model.db.model('VC');

      const docs = this._oldVersion;
      const changeRequestId = this._changeRequestId;
      delete this._oldVersion;
      delete this._changeRequestId;
      const changes = this.getUpdate().$set;

      for (let doc of docs) {
        const updatedDoc = { ...doc, ...changes };
        const objectId = updatedDoc._id;
        const docChanges = detectChanges(doc, updatedDoc);

        // add reference to change request
        docChanges.changeRequest = changeRequestId;

        // don't save if no changes
        if (
          Object.keys(docChanges.originalValues).length === 0 &&
          Object.keys(docChanges.updatedValues).length === 0
        ) {
          continue;
        }

        try {
          await VCModel.findOneAndUpdate(
            {
              docId: objectId,
              collectionName: collectionName
            },
            { $push: { changes: docChanges } },
            { upsert: true, new: true }
          );
          logger.info(
            `VC (${collectionName}) - Post hook executed successfully. (Id=${objectId})`
          );
        } catch (error) {
          logger.error(
            `VC (${collectionName}) - Error on post hook (Id=${objectId}): ${error}`
          );
        }
      }
    }
  );
};

module.default = enableVersionControl;
export = {
  emptyS3Directory,
  createApplicationThread,
  createApplicationThreadV2,
  deleteApplicationThread,
  handleProgramChanges,
  enableVersionControl
};
