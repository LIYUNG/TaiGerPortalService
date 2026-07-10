import mongoose, { Schema, Query, Types } from 'mongoose';
import path from 'path';
import type { ObjectIdentifier } from '@aws-sdk/client-s3';
import logger from '../../services/logger';
import { asyncHandler } from '../../middlewares/error-handler';
import {
  findStudentDelta,
  type ProgramLike,
  type Delta
} from './programChange';
import { ErrorResponse } from '../../common/errors';
import { AWS_S3_BUCKET_NAME } from '../../config';
import { listS3ObjectsV2, deleteS3Objects } from '../../aws/s3';

// TODO: aws-sdk v3 to be tested
// only delete first 1000 objects
export const emptyS3Directory = asyncHandler(
  async (bucket: string, dir: string) => {
    const listParams = {
      bucketName: bucket,
      Prefix: dir
    };

    const listedObjects = await listS3ObjectsV2(listParams);
    if (!listedObjects?.Contents || listedObjects.Contents.length === 0) return;

    const deleteParams: { Delete: { Objects: ObjectIdentifier[] } } = {
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
  }
);

// Minimal shapes of the (lazily-required, untyped) Application document
// fields these two thread-creation helpers actually touch.
interface ApplicationWithProgramRef {
  programId: { _id: Types.ObjectId | string };
}
interface ApplicationWithIdRef {
  _id: Types.ObjectId | string;
}

export const createApplicationThread = async (
  studentId: string,
  programId: string,
  fileType: string
) => {
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
    (app: ApplicationWithProgramRef) =>
      app.programId._id.toString() === programId.toString()
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
export const createApplicationThreadV2 = async (
  studentId: string,
  applicationId: string,
  fileType: string
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
    (app: ApplicationWithIdRef) =>
      app._id.toString() === applicationId.toString()
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

export const deleteApplicationThread = async (
  studentId: string,
  programId: string,
  messagesThreadId: string
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

interface DocChanges {
  originalValues: Record<string, unknown>;
  updatedValues: Record<string, unknown>;
  changedBy?: unknown;
  changeRequest?: unknown;
}

const detectChanges = (
  a: Record<string, unknown>,
  b: Record<string, unknown>
): DocChanges => {
  const original: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};
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

const isCrucialChanges = (changes: Record<string, unknown> | undefined) => {
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
  async (programId: Types.ObjectId | string) => {
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

    const students = applications.map(
      (app: { studentId: Types.ObjectId | string }) => app.studentId.toString()
    );
    return students;
  }
);

const handleStudentDelta = asyncHandler(
  async (studentId: string, program: ProgramLike) => {
    const studentDelta: Delta = await findStudentDelta(studentId, program);
    logger.info('studentDelta', { studentDelta });
    for (const missingDoc of studentDelta.add) {
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
    for (const extraDoc of studentDelta.remove) {
      if (extraDoc?.fileThread?.messageSize !== 0) {
        logger.info(
          // NOTE: `.fileType` does not exist on DeltaThread (it's `file_type`,
          // used correctly a few lines below) — this always logs `undefined`.
          // Pre-existing bug in this log message only (no control-flow
          // impact); preserved as-is, see FLAGGED BUGS in the PR description.
          `handleStudentDelta: thread deletion aborted (non-empty thread) for student ${studentId} and program ${
            program._id
          } with file type ${
            (extraDoc.fileThread as unknown as { fileType?: unknown }).fileType
          } -> messages exist`
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
  }
);

const handleThreadDelta = asyncHandler(async (program: ProgramLike) => {
  const affectedStudents: string[] = await findAffectedStudents(program._id);
  for (const studentId of affectedStudents) {
    try {
      await handleStudentDelta(studentId, program);
    } catch (error) {
      logger.error(
        `handleThreadDelta: error on student ${studentId} and program ${program._id}: ${error}`
      );
    }
  }
});

// Mongoose 8 dropped the legacy Query#update()/Model.update() method
// entirely, so 'update' is no longer part of @types/mongoose's query-
// middleware method unions. The hook below is a harmless no-op today but is
// kept unchanged from the pre-migration code (removing it would be a
// behavior change, not a typing fix) — the cast is needed purely because the
// *type* omits a method the runtime no longer has anyway.
type QueryUpdateHookMethod = 'findOneAndUpdate' | 'updateOne' | 'updateMany';
const QUERY_UPDATE_HOOKS = [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'update'
] as unknown as QueryUpdateHookMethod[];

// Narrow shape of the update payload these hooks care about — mirrors
// models/User.ts's PasswordUpdate pattern (getUpdate()'s raw type is
// UpdateQuery | UpdateWithAggregationPipeline | null).
type UpdateSetPayload = { $set?: Record<string, unknown> };
type UpdateChangeRequestPayload = { changeRequestId?: string };

// `this.model` on mongoose's Query type is intentionally erased to
// `Model<any>` (see mongoose/types/query.d.ts: "Can't use DocType, causes
// Type instantiation is excessively deep"), so the lean copies of the
// pre-update documents stashed here can only be typed as `any[]`.
type ProgramHookQuery = Query<unknown, unknown> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  _originals?: any[];
};

// The thread-delta helpers below pull the central default-connection models
// themselves (the service is single-connection now), so the hook only needs to
// detect crucial changes and forward the updated program docs.
export const handleProgramChanges = (schema: Schema) => {
  schema.pre(QUERY_UPDATE_HOOKS, async function (this: ProgramHookQuery) {
    try {
      const condition = this.getQuery();
      this._originals = await this.model.find(condition).lean();
    } catch (error) {
      logger.error(`ProgramHook - Error on pre hook: ${error}`);
    }
  });

  schema.post(QUERY_UPDATE_HOOKS, async function (this: ProgramHookQuery) {
    try {
      const docs = this._originals;
      delete this._originals;
      const changes = (this.getUpdate() as UpdateSetPayload | null)?.$set;
      if (!isCrucialChanges(changes) || docs?.length === 0) {
        return;
      }

      for (const doc of docs!) {
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
  });
};

// VCModel is resolved from the connection of the model that fired the hook
// (`this.model.db`), so version control works on every connection the schema is
// compiled on (default + per-request).
type VCHookQuery = Query<unknown, unknown> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see ProgramHookQuery comment above
  _oldVersion?: any[];
  _changeRequestId?: string;
};

export const enableVersionControl = (schema: Schema) => {
  schema.pre(QUERY_UPDATE_HOOKS, async function (this: VCHookQuery) {
    const collectionName = this.model.modelName;
    try {
      const condition = this.getQuery();
      this._oldVersion = await this.model.find(condition).lean();
      this._changeRequestId = (
        this.getUpdate() as UpdateChangeRequestPayload | null
      )?.changeRequestId;
    } catch (error) {
      logger.error(`VC (${collectionName}) - Error on pre hook: ${error}`);
    }
  });

  schema.post(QUERY_UPDATE_HOOKS, async function (this: VCHookQuery) {
    const collectionName = this.model.modelName;
    const VCModel = this.model.db.model('VC');

    const docs = this._oldVersion;
    const changeRequestId = this._changeRequestId;
    delete this._oldVersion;
    delete this._changeRequestId;
    const changes = (this.getUpdate() as UpdateSetPayload | null)?.$set;

    for (const doc of docs!) {
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
            collectionName
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
  });
};
