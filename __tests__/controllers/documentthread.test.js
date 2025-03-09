const fs = require('fs');
const request = require('supertest');
const { mockClient } = require('aws-sdk-client-mock');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const { UPLOAD_PATH } = require('../../config');
const { connect, closeDatabase, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { User, UserSchema } = require('../../models/User');
const { programSchema } = require('../../models/Program');
const { protect } = require('../../middlewares/auth');
const {
  permission_canAccessStudentDatabase_filter
} = require('../../middlewares/permission-filter');
const {
  InnerTaigerMultitenantFilter
} = require('../../middlewares/InnerTaigerMultitenantFilter');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { TENANT_ID } = require('../fixtures/constants');
const { users, agent, student } = require('../mock/user');
const { s3Client } = require('../../aws');
const { program1 } = require('../mock/programs');
const { disconnectFromDatabase } = require('../../database');

const s3ClientMock = mockClient(s3Client);

const requestWithSupertest = request(app);

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };

  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await ProgramModel.deleteMany();
  await ProgramModel.create(program1);

  s3ClientMock.on(PutObjectCommand).callsFake(async (input, getClient) => {
    getClient().config.endpoint = () => ({ hostname: '' });
    return {};
  });
  s3ClientMock.on(GetObjectCommand).callsFake(async () => ({
    Body: {
      transformToByteArray: async () => Buffer.from('mock file content')
    }
  }));
});

afterAll(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const ProgramModel = db.model('Program', programSchema);
  await UserModel.deleteMany();
  await ProgramModel.deleteMany();

  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {});

afterEach(() => {
  fs.rmSync(UPLOAD_PATH, { recursive: true, force: true });
});

describe('POST /api/document-threads/:category', () => {
  const thread = {
    student_id: '1234',
    file_type: 'ML',
    program_id: null,
    updatedAt: new Date()
  };
  const new_thread = {
    student_id: '1234',
    file_type: 'ML',
    program_id: null,
    updatedAt: new Date()
  };
  var article_id;

  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = await User.findById(student._id);
      next();
    });
  });

  it('todo', async () => {
    expect(200).toBe(200);
  });
});

// user: Agent
describe('POST /api/document-threads/init/application/:studentId/:programId/:document_category', () => {
  const { _id: studentId } = student;
  const { _id: programId } = program1;
  const { _id: agentId } = agent;
  const filename = 'my-file.pdf'; // will be overwrite to docName

  let r = /\d+/; //number pattern
  let version_number_max = 0;
  let db_file_name;
  let temp_name;
  let applicationIds;
  let applicationId;
  let file_name_inDB;
  let returndoc_modification_thread;
  let messagesThreadId;

  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => {
      next();
    }
  );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });
  protect.mockImplementation((req, res, next) => {
    req.user = agent;
    next();
  });

  expect(200).toBe(200);

  // TODO: need to simplify mock data.
  it('should create a new ML thread when assigned a new program with ML required', async () => {
    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/applications`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [programId.toString()] });

    expect(resp.status).toBe(201);

    const resp_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp_std.status).toBe(200);
    const newStudentData = resp_std.body.data;

    const newApplication = newStudentData.applications.find(
      (appl) => appl.programId._id?.toString() === programId
    );
    const thread = newApplication.doc_modification_thread.find(
      (thr) => thr.doc_thread_id.file_type === 'ML'
    );
    expect(thread.doc_thread_id.file_type).toBe('ML');
    messagesThreadId = thread.doc_thread_id._id?.toString();
  });

  it('should create a Supplementary_Form thread when manually added', async () => {
    const resp22 = await requestWithSupertest
      .post(
        `/api/document-threads/init/application/${studentId}/${programId}/${'Supplementary_Form'}`
      )
      .set('tenantId', TENANT_ID);
    expect(resp22.status).toBe(200);

    const resp_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp_std.status).toBe(200);
    const newStudentData = resp_std.body.data;

    const newApplication = newStudentData.applications.find(
      (appl) => appl.programId._id?.toString() === programId
    );
    const thread = newApplication.doc_modification_thread.find(
      (thr) => thr.doc_thread_id.file_type === 'Supplementary_Form'
    );
    expect(thread.doc_thread_id.file_type).toBe('Supplementary_Form');
  });

  it.each([
    ['my-file.exe', 415, false],
    ['my-file.pdf', 200, true]
  ])(
    '%p should return %p hen program specific file type not .pdf .png, .jpg and .jpeg .docx %p',
    async (File_Name, status, success) => {
      const buffer_1kB_exe = Buffer.alloc(1024 * 1); // 1 kB
      const resp2 = await requestWithSupertest
        .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
        .set('tenantId', TENANT_ID)
        .attach('files', buffer_1kB_exe, { filename: File_Name })
        .field('message', '{}');

      // expect(resp2).toBe('status');
      expect(resp2.status).toBe(status);
      expect(resp2.body.success).toBe(success);
    }
  );
  // TODO: mock S3 isntead of

  it('should return 413 when program specific file size (ML, Essay) over 1 MB', async () => {
    const buffer_2MB = Buffer.alloc(1024 * 1024 * 2); // 1 kB
    const resp2 = await requestWithSupertest
      .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
      .set('tenantId', TENANT_ID)
      .attach('files', buffer_2MB, { filename });

    expect(resp2.status).toBe(413);
    expect(resp2.body.success).toBe(false);
  });

  // it('should save the uploaded program specific file and store the path in db', async () => {
  // const resp_std = await requestWithSupertest
  //   .get(`/api/students/doc-links/${studentId}`)
  //   .set('tenantId', TENANT_ID);

  // expect(resp_std.status).toBe(200);
  // const newStudentData = resp_std.body.data;
  //   const application = newStudentData.applications.find(
  //     (appl) => appl.programId._id?.toString() === programId
  //   );

  //   application.documents.forEach((editoroutput) => {
  //     if (editoroutput.name.includes(fileCategory)) {
  //       if (
  //         editoroutput.name.match(r) !== null &&
  //         editoroutput.name.match(r)[0] > version_number_max
  //       ) {
  //         version_number_max = editoroutput.name.match(r)[0]; // get the max version number
  //       }
  //     }
  //   });

  //   var version_number = version_number_max;
  //   var same_file_name = true;
  //   while (same_file_name) {
  //     temp_name =
  //       student.lastname +
  //       '_' +
  //       student.firstname +
  //       '_' +
  //       application.programId.school +
  //       '_' +
  //       application.programId.program_name +
  //       '_' +
  //       fileCategory +
  //       '_v' +
  //       version_number +
  //       `${path.extname(filename)}`;
  //     temp_name = temp_name.replace(/ /g, '_');
  //   }
  //   const doc_idx = application.documents.findIndex(({ name }) =>
  //     name.includes(db_file_name)
  //   );

  //   file_name_inDB = path.basename(application.documents[doc_idx].path);
  //   expect(file_name_inDB).toBe(temp_name);

  //   // Test Download:
  //   const resp2 = await requestWithSupertest
  //     .get(
  //       `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
  //     )
  //     .set('tenantId', TENANT_ID)
  //     .buffer();

  //   expect(resp2.status).toBe(200);
  //   expect(resp2.headers['content-disposition']).toEqual(
  //     `attachment; filename="${temp_name}"`
  //   );

  //   // Mark as final documents
  //   const resp6 = await requestWithSupertest
  //     .put(
  //       `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
  //     )
  //     .set('tenantId', TENANT_ID);
  //   expect(resp6.status).toBe(201);
  //   expect(resp6.body.success).toBe(true);

  //   // test download: should return 400 with invalid applicationId
  //   const invalidApplicationId = 'invalidapplicationID';
  //   const resp3 = await requestWithSupertest
  //     .get(
  //       `/api/account/files/programspecific/${studentId}/${invalidApplicationId}/${whoupdate}/${temp_name}`
  //     )
  //     .set('tenantId', TENANT_ID)
  //     .buffer();

  //   expect(resp3.status).toBe(400);
  //   expect(resp3.body.success).toBe(false);
});
