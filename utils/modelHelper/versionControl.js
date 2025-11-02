const mongoose = require('mongoose');
const path = require('path');
const logger = require('../../services/logger');
const { asyncHandler } = require('../../middlewares/error-handler');
const { findStudentDelta } = require('./programChange');
const { ErrorResponse } = require('../../common/errors');
const { AWS_S3_BUCKET_NAME } = require('../../config');
const { listS3ObjectsV2, deleteS3Objects } = require('../../aws/s3');

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

const createApplicationThread = async (
  { StudentModel, ApplicationModel, DocumentthreadModel },
  studentId,
  programId,
  fileType
) => {
  const threadExisted = await DocumentthreadModel.findOne({
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
  const student = await StudentModel.findById(studentId);
  const applications = await ApplicationModel.find({ studentId }).populate(
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

  const newThread = new DocumentthreadModel({
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

// only for initApplicationMessagesThread
const createApplicationThreadV2 = async (
  { StudentModel, ApplicationModel, DocumentthreadModel },
  studentId,
  applicationId,
  fileType
) => {
  const threadExisted = await DocumentthreadModel.findOne({
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
  const student = await StudentModel.findById(studentId);
  const applications = await ApplicationModel.find({ studentId }).populate(
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

  const newThread = new DocumentthreadModel({
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
  req,
  studentId,
  programId,
  messagesThreadId
) => {
  // Before delete the thread, please delete all of the files in the thread!!
  // Delete folder
  let directory = path.join(studentId, messagesThreadId);
  logger.info('Trying to delete message thread and folder');
  directory = directory.replace(/\\/g, '/');
  emptyS3Directory(AWS_S3_BUCKET_NAME, directory);

  await req.ApplicationModel.findOneAndUpdate(
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
  const thread = await req.DocumentthreadModel.findByIdAndDelete(
    messagesThreadId
  );
  await req.surveyInputModel.deleteOne({
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

const findAffectedStudents = asyncHandler(
  async (programId, { ApplicationModel }) => {
    // non-archived student has open application for program
    const applications = await ApplicationModel.find({
      programId,
      closed: '-',
      archive: { $ne: true }
    })
      .select('studentId')
      .lean();

    const students = applications.map((app) => app.studentId.toString());
    return students;
  }
);

const handleStudentDelta = asyncHandler(
  async (
    studentId,
    program,
    { StudentModel, ApplicationModel, DocumentthreadModel, surveyInputModel }
  ) => {
    const studentDelta = await findStudentDelta(studentId, program, {
      DocumentthreadModel
    });
    console.log('studentDelta', studentDelta);
    for (let missingDoc of studentDelta.add) {
      try {
        await createApplicationThread(
          { StudentModel, ApplicationModel, DocumentthreadModel },
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
          {
            ApplicationModel,
            StudentModel,
            DocumentthreadModel,
            surveyInputModel
          },
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
  }
);

const handleThreadDelta = asyncHandler(
  async (
    program,
    { StudentModel, ApplicationModel, DocumentthreadModel, surveyInputModel }
  ) => {
    const affectedStudents = await findAffectedStudents(program._id, {
      ApplicationModel
    });
    for (let studentId of affectedStudents) {
      try {
        await handleStudentDelta(studentId, program, {
          StudentModel,
          ApplicationModel,
          DocumentthreadModel,
          surveyInputModel
        });
      } catch (error) {
        logger.error(
          `handleThreadDelta: error on student ${studentId} and program ${program._id}: ${error}`
        );
      }
    }
  }
);

const handleProgramChanges = (
  schema,
  { StudentModel, ApplicationModel, DocumentthreadModel, surveyInputModel }
) => {
  schema.pre(
    ['findOneAndUpdate', 'updateOne', 'updateMany', 'update'],
    async function (doc) {
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
    async function (doc) {
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
            await handleThreadDelta(updatedDoc, {
              StudentModel,
              ApplicationModel,
              DocumentthreadModel,
              surveyInputModel
            });
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

const enableVersionControl = (schema, { VCModel }) => {
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
module.exports = {
  emptyS3Directory,
  createApplicationThread,
  createApplicationThreadV2,
  deleteApplicationThread,
  handleProgramChanges,
  enableVersionControl
};
