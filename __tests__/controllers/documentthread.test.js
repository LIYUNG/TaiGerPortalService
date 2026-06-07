// DB-free rewrite.
//
// This suite used to boot an in-memory Mongo plus a separate tenant connection
// (`connect()` + `connectToDatabase(TENANT_ID, dbUri)`) and tear them down in
// `afterAll`. Creating applications fires the `handleProgramChanges` /
// `enableVersionControl` Mongoose plugins, whose async writes were still
// in-flight when the connection was closed — so teardown intermittently threw
//   MongoClientClosedError: Operation interrupted because client was closed
// making the whole file flaky.
//
// The ORM is now mocked end-to-end, so no Mongo connection is ever opened:
//   1. `createApplicationV2` is unit-tested against fake models — real
//      controller logic, fake data layer. This is the "create ML thread when a
//      program with ML required is assigned" behaviour.
//   2. The thread file-upload validation (.exe / .pdf / size limit) is tested
//      against the *real* multer middleware with S3 mocked — no DB involved.

const express = require('express');
const request = require('supertest');
const { mockClient } = require('aws-sdk-client-mock');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');

// Mock the email layer so the post-response notification in createApplicationV2
// never tries to send a real email.
jest.mock('../../services/email', () => ({
  createApplicationToStudentEmail: jest.fn().mockResolvedValue(undefined),
  UpdateStudentApplicationsEmail: jest.fn().mockResolvedValue(undefined),
  NewMLRLEssayTasksEmail: jest.fn().mockResolvedValue(undefined),
  NewMLRLEssayTasksEmailFromTaiGer: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../services/students');
jest.mock('../../services/applications');
jest.mock('../../services/programs');
jest.mock('../../services/documentthreads');

const { createApplicationV2 } = require('../../controllers/applications');
const { MessagesThreadUpload } = require('../../middlewares/file-upload');
const { errorHandler } = require('../../middlewares/error-handler');
const { s3Client } = require('../../aws');
const StudentService = require('../../services/students');
const ApplicationService = require('../../services/applications');
const ProgramService = require('../../services/programs');
const DocumentThreadService = require('../../services/documentthreads');

// ---------------------------------------------------------------------------
// Tiny Mongoose-ish test doubles wired into the mocked service layer.
// ---------------------------------------------------------------------------

// Builds the service-layer doubles plus handles to inspect what the controller
// created.
const buildMockDb = ({ studentId, programId }) => {
  const createdThreads = [];

  const studentDoc = {
    _id: studentId,
    firstname: 'Test',
    lastname: 'Student',
    email: 'student@example.com',
    application_preference: { expected_application_date: '2025' },
    generaldocs_threads: [],
    notification: {},
    save: jest.fn().mockResolvedValue(true)
  };

  // ml_required: 'yes' -> the supplementary-form loop should create one ML
  // thread. rl_required left undefined -> the RL block is skipped.
  const programDoc = {
    _id: new mongoose.Types.ObjectId(programId),
    school: 'Test School',
    program_name: 'Test Program',
    degree: 'MSc',
    semester: 'WS',
    country: 'de',
    ml_required: 'yes'
  };

  // `application.doc_modification_thread` is a subdoc array: it must support
  // both Array#push and Mongoose's `.create()` helper.
  const docModThread = [];
  docModThread.create = (entry) => entry;
  const applicationDoc = {
    _id: new mongoose.Types.ObjectId(),
    studentId,
    doc_modification_thread: docModThread,
    save: jest.fn().mockResolvedValue(true)
  };

  // Documentthread constructor double (DocumentThreadService.newThread).
  function Documentthread(doc) {
    Object.assign(this, doc);
    this._id = new mongoose.Types.ObjectId();
    this.save = jest.fn().mockResolvedValue(this);
    createdThreads.push(this);
  }

  StudentService.getStudentDocById.mockResolvedValue(studentDoc);
  ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
  ApplicationService.createApplicationDoc.mockResolvedValue(applicationDoc);
  ApplicationService.findByStudentIdPopulatedFull.mockResolvedValue([]);
  ProgramService.findPrograms.mockResolvedValue([programDoc]);
  DocumentThreadService.newThread.mockImplementation(
    (doc) => new Documentthread(doc)
  );
  DocumentThreadService.countThreads.mockResolvedValue(0);

  return {
    studentDoc,
    applicationDoc,
    createdThreads
  };
};

describe('createApplicationV2 (ORM mocked)', () => {
  it('creates an ML thread when a program with ML required is assigned', async () => {
    const studentId = new mongoose.Types.ObjectId().toString();
    const programId = new mongoose.Types.ObjectId().toString();
    const mock = buildMockDb({ studentId, programId });

    const req = {
      db: mock.db,
      user: { firstname: 'Agent', lastname: 'Smith', email: 'agent@a.com' },
      params: { studentId },
      body: { program_id_set: [programId] }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await createApplicationV2(req, res, next);

    // No error path was taken.
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).toHaveBeenCalledWith(201);

    // The application was created and persisted.
    expect(mock.applicationDoc.save).toHaveBeenCalled();
    expect(mock.studentDoc.save).toHaveBeenCalled();

    // Exactly one thread, of type ML, was created and saved.
    const mlThreads = mock.createdThreads.filter((t) => t.file_type === 'ML');
    expect(mlThreads).toHaveLength(1);
    expect(mlThreads[0].student_id.toString()).toBe(studentId);
    expect(mlThreads[0].save).toHaveBeenCalled();
    // It is linked into the application's doc_modification_thread list.
    expect(mock.applicationDoc.doc_modification_thread).toContainEqual(
      expect.objectContaining({
        doc_thread_id: mlThreads[0]._id
      })
    );
  });

  it('rejects when more than the max number of programs are assigned', async () => {
    const studentId = new mongoose.Types.ObjectId().toString();
    const mock = buildMockDb({
      studentId,
      programId: new mongoose.Types.ObjectId().toString()
    });
    const program_id_set = Array.from({ length: 21 }, () =>
      new mongoose.Types.ObjectId().toString()
    );

    const req = {
      db: mock.db,
      user: { firstname: 'Agent', lastname: 'Smith', email: 'agent@a.com' },
      params: { studentId },
      body: { program_id_set }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await createApplicationV2(req, res, next);

    // asyncHandler forwards the ErrorResponse to next(); nothing is created.
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(res.status).not.toHaveBeenCalledWith(201);
    expect(mock.createdThreads).toHaveLength(0);
  });
});

describe('Document thread file upload validation (multer, S3 mocked, no DB)', () => {
  const s3ClientMock = mockClient(s3Client);

  // The thread storage's `key` callback derives the S3 object name from the
  // thread via DocumentThreadService (default-connection DAO layer). Stub it so
  // the upload can complete without a real connection.
  const threadDoc = {
    _id: 'thread1',
    file_type: 'ML',
    program_id: undefined,
    student_id: { firstname: 'Test', lastname: 'Student' },
    messages: []
  };

  // Minimal app exercising only the real upload middleware + error handler.
  const uploadApp = express();
  uploadApp.post(
    '/upload/:messagesThreadId/:studentId',
    MessagesThreadUpload,
    (req, res) => {
      res.status(200).send({ success: true });
    }
  );
  uploadApp.use(errorHandler);

  const uploadAgent = request(uploadApp);
  const uploadUrl = '/upload/653d1e116f4c8c637dd1c971/653d1e116f4c8c637dd1c000';

  beforeEach(() => {
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue(
      threadDoc
    );
    s3ClientMock.reset();
    s3ClientMock.on(PutObjectCommand).callsFake(async (input, getClient) => {
      // eslint-disable-next-line no-param-reassign
      getClient().config.endpoint = () => ({ hostname: '' });
      return {};
    });
  });

  it.each([
    ['my-file.exe', 415, false],
    ['my-file.pdf', 200, true]
  ])(
    '%p should return %p (success=%p) based on the allowed file type',
    async (filename, status, success) => {
      const buffer = Buffer.alloc(1024); // 1 kB — under the limit
      const resp = await uploadAgent
        .post(uploadUrl)
        .attach('files', buffer, { filename });

      expect(resp.status).toBe(status);
      expect(resp.body.success).toBe(success);
    }
  );

  it('rejects an upload that exceeds the 1 MB document size limit', async () => {
    const buffer = Buffer.alloc(1024 * 1024 * 2); // 2 MB — over the limit
    const resp = await uploadAgent
      .post(uploadUrl)
      .attach('files', buffer, { filename: 'my-file.pdf' });

    expect(resp.status).toBe(413);
    expect(resp.body.success).toBe(false);
  });
});
