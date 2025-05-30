const fs = require('fs');
const request = require('supertest');
const { mockClient } = require('aws-sdk-client-mock');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const { UPLOAD_PATH } = require('../../config');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { Student, UserSchema } = require('../../models/User');
const { protect, permit } = require('../../middlewares/auth');
const {
  InnerTaigerMultitenantFilter
} = require('../../middlewares/InnerTaigerMultitenantFilter');
const {
  permission_canAccessStudentDatabase_filter
} = require('../../middlewares/permission-filter');
const { programSchema } = require('../../models/Program');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { documentThreadsSchema } = require('../../models/Documentthread');
const {
  users,
  admin,
  agents,
  agent,
  editors,
  student,
  student2
} = require('../mock/user');
const { s3Client } = require('../../aws');
const { program1, programs } = require('../mock/programs');
const { disconnectFromDatabase } = require('../../database');

const s3ClientMock = mockClient(s3Client);
const requestWithSupertest = request(app);

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

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

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough),
    permission_canAssignAgent_filter: jest.fn().mockImplementation(passthrough),
    permission_canAssignEditor_filter: jest.fn().mockImplementation(passthrough)
  };
});

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
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
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await ProgramModel.deleteMany();

  await UserModel.insertMany(users);
  await ProgramModel.insertMany(programs);
});

afterEach(() => {
  fs.rmSync(UPLOAD_PATH, { recursive: true, force: true });
});

describe('POST /api/students/:id/agents', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });

  it('should assign agent(s) to student', async () => {
    const { _id: studentId } = student;

    const agents_obj = {};
    agents.forEach((ag) => {
      agents_obj[ag._id] = true;
    });

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/agents`)
      .set('tenantId', TENANT_ID)
      .send(agents_obj);

    expect(resp.status).toBe(200);

    var agents_arr = [];
    agents.forEach((ag) => {
      if ((agents_obj[ag._id] = true)) {
        agents_arr.push(ag._id);
      }
    });

    const updatedStudent = await Student.findById(studentId).lean();
    expect(updatedStudent.agents.map(String)).toEqual(agents_arr);
  });
});

describe('POST /api/students/:id/editors', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
  it('should assign editors to student', async () => {
    const { _id: studentId } = student;
    const { _id: editorId } = editors[0];

    const editors_obj = {};
    editors.forEach((editor) => {
      editors_obj[editor._id] = true;
    });

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/editors`)
      .set('tenantId', TENANT_ID)
      .send(editors_obj);

    expect(resp.status).toBe(200);

    var editors_arr = [];
    editors.forEach((editor) => {
      if ((editors_obj[editor._id] = true)) {
        editors_arr.push(editor._id);
      }
    });

    const updatedStudent = await Student.findById(studentId).lean();
    expect(updatedStudent.editors.map(String)).toEqual(editors_arr);
    // TODO: verify editors data
    // const updatedEditor = await Editor.findById(editorId).lean();
    // expect(updatedEditor.students.map(String)).toEqual([studentId]);
  });
});

// Agent should create applications (programs) to student
describe('POST /api/students/:studentId/applications', () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
  // permission_canAccessStudentDatabase_filter.mockImplementation(
  //   async (req, res, next) => {
  //     next();
  //   }
  // );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  it('should create an application for student', async () => {
    const { _id: studentId } = student;
    const programs_arr = [];
    programs.forEach((pro) => {
      programs_arr.push(pro._id.toString());
    });
    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/applications`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: programs_arr });

    const {
      status,
      body: { success, data }
    } = resp;

    expect(status).toBe(201);
    expect(success).toBe(true);
    // expect(data.applications.length).toMatchObject(programs_arr);
  });
});

describe('DELETE /api/students/:studentId/applications/:applicationId', () => {
  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => {
      next();
    }
  );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  protect.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
  it('should delete an application from student', async () => {
    const { _id: studentId } = student;

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/applications`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id?.toString()] });

    expect(resp.status).toBe(201);
    const applications = resp.body.data;
    const applicationId = applications[0]._id;
    const resp2 = await requestWithSupertest
      .delete(`/api/students/${studentId}/applications/${applicationId}`)
      .set('tenantId', TENANT_ID);

    expect(resp2.status).toBe(200);
    const resp2_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);
    expect(resp2_std.body.data.applications).toHaveLength(0);
  });

  it('deleting an application should fail if one of the threads is none-empty', async () => {
    const { _id: studentId } = student;

    const resp = await requestWithSupertest
      .post(`/api/students/${studentId}/applications`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: [program1._id?.toString()] });

    expect(resp.status).toBe(201);

    const resp_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp_std.status).toBe(200);
    const newStudentData = resp_std.body.data;

    const newApplication = newStudentData.applications.find(
      (appl) => appl.programId._id?.toString() === program1._id?.toString()
    );
    const thread = newApplication.doc_modification_thread.find(
      (thr) => thr.doc_thread_id.file_type === 'ML'
    );
    expect(thread.doc_thread_id.file_type).toBe('ML');
    const messagesThreadId = thread.doc_thread_id._id?.toString();

    const resp2 = await requestWithSupertest
      .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
      .set('tenantId', TENANT_ID)
      .field('message', '{}');
    expect(resp2.status).toBe(200);
    const application_id = newApplication._id;
    const resp3 = await requestWithSupertest
      .delete(`/api/students/${studentId}/applications/${application_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp3.status).toBe(409);
    const resp3_std = await requestWithSupertest
      .get(`/api/students/doc-links/${studentId}`)
      .set('tenantId', TENANT_ID);
    expect(resp3_std.body.data.applications).toHaveLength(1);
  });
});

// Student uploads profile files
// user: Student
describe('POST /api/students/:studentId/files/:category', () => {
  const { _id: studentId } = student;
  const { _id: student2Id } = student2;
  const filename_invalid_ext = 'invalid_extension.exe'; // will be overwrite to docName
  const filename = 'my-file.pdf'; // will be overwrite to docName
  const category = 'Bachelor_Transcript';

  let temp_name;

  protect.mockImplementation(async (req, res, next) => {
    req.user = student;
    next();
  });

  it('should return 415 when profile file type not .pdf .png, .jpg and .jpeg .docx', async () => {
    let buffer_2MB_exe = Buffer.alloc(1024 * 1024 * 2); // 2 MB
    const resp2 = await requestWithSupertest
      .post(`/api/students/${studentId}/files/${category}`)
      .set('tenantId', TENANT_ID)
      .attach('file', buffer_2MB_exe, { filename: filename_invalid_ext });

    expect(resp2.status).toBe(415);
    expect(resp2.body.success).toBe(false);
    buffer_2MB_exe = null; // Mark for GC
    if (global.gc) global.gc(); // Force GC if available
  });

  // TODO: take too much time
  // it('should return 413 when profile size over 5 MB', async () => {
  //   const buffer_10MB = Buffer.alloc(1024 * 1024 * 6); // 6 MB
  //   const resp2 = await requestWithSupertest
  //     .post(`/api/students/${studentId}/files/${category}`)
  //     .set('tenantId', TENANT_ID)
  //     .attach('file', buffer_10MB, { filename });

  //   expect(resp2.text).toBe(413);
  //   expect(resp2.body.success).toBe(false);
  // });

  // TODO: take too long to test
  // it('should save the uploaded profile file and store the path in db', async () => {
  //   let buffer_1kB_exe = Buffer.alloc(1024 * 1); // 1 kB

  //   const resp = await requestWithSupertest
  //     .post(`/api/students/${studentId}/files/${category}`)
  //     .set('tenantId', TENANT_ID)
  //     .attach('file', buffer_1kB_exe, { filename });

  //   const { status, body } = resp;
  //   expect(status).toBe(201);
  //   expect(body.success).toBe(true);
  //   // Cleanup
  //   buffer_1kB_exe = null; // Mark for GC
  //   if (global.gc) global.gc(); // Force GC if available

  //   const updatedFile = body.data;

  //   temp_name = `${student.lastname}_${
  //     student.firstname
  //   }_${category}${path.extname(updatedFile.path)}`;

  //   const file_name_inDB = path.basename(updatedFile.path);

  //   expect(updatedFile.name).toBe(category);
  //   expect(file_name_inDB).toBe(temp_name);

  //   // Test Download:
  //   const resp2 = await requestWithSupertest
  //     .get(`/api/students/${studentId}/files/${category}`)
  //     .set('tenantId', TENANT_ID)
  //     .buffer();

  //   expect(resp2.status).toBe(200);
  //   expect(resp2.headers['content-disposition']).toEqual(
  //     `attachment; filename="${temp_name}"`
  //   );

  //   // TODO: test download: should not download other students's stuff!
  //   // const invalidApplicationId = "invalidapplicationID";
  //   // const resp3 = await requestWithSupertest
  //   //   .get(`/api/students/${studentId}/files/${category}`)
  //   //   .buffer();

  //   // expect(resp3).toBe(400);
  //   // expect(resp3.body.success).toBe(false);

  //   // test delete
  //   const resp4 = await requestWithSupertest
  //     .delete(`/api/students/${studentId}/files/${category}`)
  //     .set('tenantId', TENANT_ID);
  //   expect(resp4.status).toBe(200);
  //   expect(resp4.body.success).toBe(true);

  //   // TODO test delete: should not delete other students file
  //   const resp5 = await requestWithSupertest
  //     .delete(`/api/students/${student2Id}/files/${category}`)
  //     .set('tenantId', TENANT_ID);
  //   expect(resp5.status).toBe(403);
  //   expect(resp5.body.success).toBe(false);
  // });
});

// user: Agent
describe('POST /api/students/:studentId/files/:category', () => {
  const { _id: studentId } = student;
  const filename = 'my-file.pdf'; // will be overwrite to docName
  const category = 'Bachelor_Transcript';

  let temp_name;

  permit.mockImplementation(async (req, res, next) => {
    req.user = agent;
    next();
  });
  permission_canAccessStudentDatabase_filter.mockImplementation(
    async (req, res, next) => {
      next();
    }
  );
  InnerTaigerMultitenantFilter.mockImplementation(async (req, res, next) => {
    next();
  });

  it.each([
    ['my-file.exe', 415, false],
    ['my-file.pdf', 201, true]
  ])(
    'should return 415 when profile file type not .pdf .png, .jpg and .jpeg .docx',
    async (File_Name, status, success) => {
      let buffer_1MB_exe = Buffer.alloc(1024 * 1024 * 1); // 1 MB
      const resp2 = await requestWithSupertest
        .post(`/api/students/${studentId.toString()}/files/${category}`)
        .set('tenantId', TENANT_ID)
        .attach('file', buffer_1MB_exe, { filename: File_Name });

      expect(resp2.status).toBe(status);
      expect(resp2.body.success).toBe(success);
      // Cleanup
      buffer_1MB_exe = null; // Mark for GC
      if (global.gc) global.gc(); // Force GC if available
    }
  );

  // TODO: take too much time
  // it('should return 413 when profile size over 5 MB', async () => {
  //   const buffer_10MB = Buffer.alloc(1024 * 1024 * 6); // 6 MB
  //   const resp2 = await requestWithSupertest
  //     .post(`/api/students/${studentId.toString()}/files/${category}`)
  //     .set('tenantId', TENANT_ID)
  //     .attach('file', buffer_10MB, { filename });

  //   expect(resp2.text).toBe(413);
  //   expect(resp2.body.success).toBe(false);
  // });

  // TODO: take too much to run
  // it('should save the uploaded profile file and store the path in db', async () => {
  //   let buffer_1kB_exe = Buffer.alloc(1024 * 1); // 1 kB
  //   const resp = await requestWithSupertest
  //     .post(`/api/students/${studentId.toString()}/files/${category}`)
  //     .set('tenantId', TENANT_ID)
  //     .attach('file', buffer_1kB_exe, { filename });

  //   const { status, body } = resp;
  //   expect(status).toBe(201);
  //   expect(body.success).toBe(true);
  //   // Cleanup
  //   buffer_1kB_exe = null; // Mark for GC
  //   if (global.gc) global.gc(); // Force GC if available

  //   const updatedFile = body.data;
  //   temp_name = `${student.lastname}_${
  //     student.firstname
  //   }_${category}${path.extname(updatedFile.path)}`;

  //   const file_name_inDB = path.basename(updatedFile.path);

  //   expect(updatedFile.name).toBe(category);
  //   expect(file_name_inDB).toBe(temp_name);

  //   // Test Download:
  //   const resp2 = await requestWithSupertest
  //     .get(`/api/students/${studentId.toString()}/files/${category}`)
  //     .set('tenantId', TENANT_ID)
  //     .buffer();

  //   expect(resp2.status).toBe(200);
  //   expect(resp2.headers['content-disposition']).toEqual(
  //     `attachment; filename="${temp_name}"`
  //   );

  //   // TODO: test download: should not download other students's stuff!
  //   // const invalidApplicationId = "invalidapplicationID";
  //   // const resp3 = await requestWithSupertest
  //   //   .get(`/api/students/${studentId.toString()}/files/${category}`)
  //   //   .buffer();

  //   // expect(resp3).toBe(400);
  //   // expect(resp3.body.success).toBe(false);

  //   // test update profile status
  //   const feedback_str = 'too blurred';
  //   const resp5 = await requestWithSupertest
  //     .post(`/api/students/${studentId}/${category}/status`)
  //     .set('tenantId', TENANT_ID)
  //     .send({ status: 'rejected', feedback: feedback_str });
  //   expect(resp5.status).toBe(201);
  //   const updatedFile2 = resp5.body.data;

  //   expect(resp5.body.success).toBe(true);
  //   expect(updatedFile2.feedback).toBe(feedback_str);

  //   // test delete
  //   const resp4 = await requestWithSupertest
  //     .delete(`/api/students/${studentId}/files/${category}`)
  //     .set('tenantId', TENANT_ID);
  //   expect(resp4.status).toBe(200);
  //   expect(resp4.body.success).toBe(true);
  // });
});

// //TODO: token-specific API!!!
// describe("GET /api/students", () => {
//   it("should return role-specific students", async () => {
//     const resp = await requestWithSupertest.get("/api/students").set('tenantId', TENANT_ID);
//     const { success, data } = resp.body;

//     const studentIds = students.map(({ _id }) => _id).sort();
//     // const receivedIds = data.map(({ _id }) => _id).sort();

//     expect(resp.status).toBe(200);
//     expect(success).toBe(true);
//     // expect(receivedIds).toEqual(studentIds);
//   });
// });

// TODO: token-specific API!!!
// describe("GET /api/students/archiv", () => {
//   it("should return all archiv students", async () => {
//     const resp = await requestWithSupertest.get("/api/students/archiv");
//     const { success, data } = resp.body;

//     const studentIds = students.map(({ _id }) => _id).sort();
//     const receivedIds = data.map(({ _id }) => _id).sort();

//     expect(resp.status).toBe(200);
//     expect(success).toBe(true);
//     expect(receivedIds).toEqual(studentIds);
//   });
// });
