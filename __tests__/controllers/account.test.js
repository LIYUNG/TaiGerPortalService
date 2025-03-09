const path = require('path');
const request = require('supertest');

const { connect, closeDatabase, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { programSchema } = require('../../models/Program');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { program1 } = require('../mock/programs');
const { users, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

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

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID); // Properly close each connection
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await ProgramModel.deleteMany();
  await ProgramModel.create(program1);

  protect.mockImplementation(async (req, res, next) => {
    req.user = await UserModel.findById(student._id);
    next();
  });
});

describe('updateCredentials Controller', () => {
  it('should update the user password and send an email', async () => {
    const resp = await requestWithSupertest
      .post('/api/account/credentials')
      .set('tenantId', TENANT_ID)
      .send({
        credentials: {
          new_password: 'somepassword'
        }
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toEqual(true);
  });

  it('should return an error if the user is not found', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = { _id: '012345678901234567891234' };
      next();
    });
    const resp = await requestWithSupertest
      .post('/api/account/credentials')
      .set('tenantId', TENANT_ID)
      .send({
        credentials: {
          new_password: 'somepassword'
        }
      });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toEqual(false);
  });
});

// user: Editor
// describe('POST /api/account/files/programspecific/upload/:studentId/:applicationId/:fileCategory', () => {
//   const { _id: studentId } = student;
//   var docName = requiredDocuments[0];
//   const filename = 'my-file.pdf'; // will be overwrite to docName
//   const fileCategory = 'ML';
//   var whoupdate = 'Editor';
//   let version_number_max = 0;
//   let temp_name;
//   let db_file_name;
//   var applicationIds;
//   var applicationId;
//   var file_name_inDB;
//   var r = /\d+/; //number pattern
//   beforeEach(async () => {
//     protect.mockImplementation(async (req, res, next) => {
//       req.user = await User.findById(editor._id);
//       next();
//     });

//     const resp = await requestWithSupertest
//       .post(`/api/students/${studentId}/applications`)
//       .send({ program_id_set: [program._id] });

//     applicationIds = resp.body.data;
//     applicationId = applicationIds[0];
//   });

// it.each([
//   ['my-file.exe', 400, false],
//   ['my-file.pdf', 201, true]
// ])(
//   'should return 400 when program specific file type not .pdf .png, .jpg and .jpeg .docx %p %p %p',
//   async (File_Name, status, success) => {
//     const buffer_1MB_exe = Buffer.alloc(1024 * 1024 * 1); // 1 MB
//     const resp2 = await requestWithSupertest
//       .post(
//         `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//       )
//       .attach('file', buffer_1MB_exe, File_Name);

//     expect(resp2.status).toBe(status);
//     expect(resp2.body.success).toBe(success);
//   }
// );

// it('should return 400 when program specific file size (ML, Essay) over 5 MB', async () => {
//   const buffer_6MB = Buffer.alloc(1024 * 1024 * 6); // 6 MB
//   const resp2 = await requestWithSupertest
//     .post(
//       `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//     )
//     .attach('file', buffer_6MB, filename);

//   expect(resp2.status).toBe(400);
//   expect(resp2.body.success).toBe(false);
// });

// it('should save the uploaded program specific file and store the path in db', async () => {
//   const resp = await requestWithSupertest
//     .post(
//       `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//     )
//     .attach('file', Buffer.from('Lorem ipsum'), filename);

//   const { status, body } = resp;
//   expect(status).toBe(201);
//   expect(body.success).toBe(true);

// const resp_dup = await requestWithSupertest
//   .post(
//     `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//   )
//   .attach("file", Buffer.from("Lorem ipsum"), filename);
// expect(resp_dup.status).toBe(201);
// expect(resp_dup.body.success).toBe(true);

// // test delete first
// const resp4 = await requestWithSupertest.delete(
//   `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
// );
// expect(resp4.status).toBe(200);
// expect(resp4.body.success).toBe(true);

// var updatedStudent = await Student.findById(studentId)
//   .populate('applications.programId')
//   .lean()
//   .exec();
// var application = updatedStudent.applications.find(
//   ({ programId }) => programId._id == applicationId
// );

// application.documents.forEach((editoroutput) => {
//   if (editoroutput.name.includes(fileCategory)) {
//     if (
//       editoroutput.name.match(r) !== null &&
//       editoroutput.name.match(r)[0] > version_number_max
//     ) {
//       version_number_max = editoroutput.name.match(r)[0]; // get the max version number
//     }
//   }
// });

// let version_number = version_number_max;
// var same_file_name = true;
// while (same_file_name) {
//   temp_name =
//     student.lastname +
//     '_' +
//     student.firstname +
//     '_' +
//     application.programId.school +
//     '_' +
//     application.programId.program_name +
//     '_' +
//     fileCategory +
//     '_v' +
//     version_number +
//     `${path.extname(filename)}`;
//   temp_name = temp_name.replace(/ /g, '_');

// }

//     const doc_idx = application.documents.findIndex(({ name }) =>
//       // name.includes(version_number.toString())
//       name.includes(db_file_name)
//     );

//     file_name_inDB = path.basename(application.documents[doc_idx].path);
//     expect(file_name_inDB).toBe(db_file_name);

//     // Test Download:
//     const resp2 = await requestWithSupertest
//       .get(
//         `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
//       )
//       .buffer();

//     expect(resp2.status).toBe(200);
//     expect(resp2.headers['content-disposition']).toEqual(
//       `attachment; filename="${temp_name}"`
//     );

//     // Mark as final documents
//     const resp6 = await requestWithSupertest.put(
//       `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp6.status).toBe(201);
//     expect(resp6.body.success).toBe(true);

//     // test download: should return 400 with invalid applicationId
//     const invalidApplicationId = 'invalidapplicationID';
//     const resp3 = await requestWithSupertest
//       .get(
//         `/api/account/files/programspecific/${studentId}/${invalidApplicationId}/${whoupdate}/${temp_name}`
//       )
//       .buffer();

//     expect(resp3.status).toBe(400);
//     expect(resp3.body.success).toBe(false);

//     // test delete
//     const resp4 = await requestWithSupertest.delete(
//       `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp4.status).toBe(200);
//     expect(resp4.body.success).toBe(true);
//   });
// });

// user: Student
// describe('POST /api/account/files/programspecific/upload/:studentId/:applicationId/:fileCategory', () => {
//   const { _id: studentId } = student;
//   const { _id: student2Id } = student2;
//   var docName = requiredDocuments[0];
//   const filename = 'my-file.pdf'; // will be overwrite to docName
//   const fileCategory = 'ML';
//   let version_number_max = 0;
//   var r = /\d+/; //number pattern
//   var whoupdate = 'Student';
//   let temp_name;
//   let db_file_name;
//   var applicationIds;
//   var applicationId;
//   var file_name_inDB;
//   beforeEach(async () => {
//     protect.mockImplementation(async (req, res, next) => {
//       req.user = await User.findById(student._id);
//       next();
//     });

//     const resp = await requestWithSupertest
//       .post(`/api/students/${studentId}/applications`)
//       .send({ program_id_set: [program._id] });

//     applicationIds = resp.body.data;
//     applicationId = applicationIds[0];
//   });

// it.each([
//   ['my-file.exe', 400, false],
//   ['my-file.pdf', 201, true]
// ])(
//   'should return 400 when program specific file type not .pdf .png, .jpg and .jpeg .docx %p %p %p',
//   async (File_Name, status, success) => {
//     const buffer_1MB_exe = Buffer.alloc(1024 * 1024 * 1); // 1 MB
//     const resp2 = await requestWithSupertest
//       .post(
//         `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//       )
//       .attach('file', buffer_1MB_exe, File_Name);

//     expect(resp2.status).toBe(status);
//     expect(resp2.body.success).toBe(success);
//   }
// );

// it('should return 400 when program specific file size (ML, Essay) over 5 MB', async () => {
//   const buffer_6MB = Buffer.alloc(1024 * 1024 * 6); // 6 MB
//   const resp2 = await requestWithSupertest
//     .post(
//       `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//     )
//     .attach('file', buffer_6MB, filename);

//   expect(resp2.status).toBe(400);
//   expect(resp2.body.success).toBe(false);
// });

//   it('should save the uploaded program specific file and store the path in db', async () => {
//     const resp = await requestWithSupertest
//       .post(
//         `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//       )
//       .attach('file', Buffer.from('Lorem ipsum'), filename);

//     const { status, body } = resp;
//     expect(status).toBe(201);
//     expect(body.success).toBe(true);

//     // const resp_dup = await requestWithSupertest
//     //   .post(
//     //     `/api/account/files/programspecific/upload/${studentId}/${applicationId}/${fileCategory}`
//     //   )
//     //   .attach("file", Buffer.from("Lorem ipsum"), filename);

//     // expect(resp_dup.status).toBe(201);
//     // expect(resp_dup.body.success).toBe(true);

//     var updatedStudent = await Student.findById(studentId)
//       .populate('applications.programId')
//       .lean()
//       .exec();
//     var application = updatedStudent.applications.find(
//       ({ programId }) => programId._id == applicationId
//     );

//     let version_number = version_number_max;
//     var same_file_name = true;
//     while (same_file_name) {
//       temp_name =
//         student.lastname +
//         '_' +
//         student.firstname +
//         '_' +
//         application.programId.school +
//         '_' +
//         application.programId.program_name +
//         '_' +
//         fileCategory +
//         '_v' +
//         version_number +
//         `${path.extname(filename)}`;
//       temp_name = temp_name.replace(/ /g, '_');

//     }

//     // Test Download:
//     const resp2 = await requestWithSupertest
//       .get(
//         `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
//       )
//       .buffer();
//     expect(resp2.status).toBe(200);
//     expect(resp2.headers['content-disposition']).toEqual(
//       `attachment; filename="${temp_name}"`
//     );

//     // test download: should return 400 with invalid applicationId
//     const invalidApplicationId = 'invalidapplicationID';
//     const resp3 = await requestWithSupertest
//       .get(
//         `/api/account/files/programspecific/${studentId}/${invalidApplicationId}/${whoupdate}/${temp_name}`
//       )
//       .buffer();

//     expect(resp3.status).toBe(400);
//     expect(resp3.body.success).toBe(false);

//     // Mark as final documents (Invalid operation for student)
//     const resp6 = await requestWithSupertest.put(
//       `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp6.status).toBe(401);
//     expect(resp6.body.success).toBe(false);

//     // test delete
//     const resp4 = await requestWithSupertest.delete(
//       `/api/account/files/programspecific/${studentId}/${applicationId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp4.status).toBe(200);
//     expect(resp4.body.success).toBe(true);

//     // test delete: student can not delete other student's file
//     const resp5 = await requestWithSupertest.delete(
//       `/api/account/files/programspecific/${student2Id}/${applicationId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp5.status).toBe(401);
//     expect(resp5.body.success).toBe(false);
//   });
// });

// uploading edutir general files like CV, RL_1, RL_2, by Editor (Admin, Agent)
// describe('POST /api/account/files/general/upload/:studentId/:fileCategory', () => {
//   const { _id: studentId } = student;
//   var docName = requiredDocuments[0];
//   const filename = 'my-file.pdf'; // will be overwrite to docName
//   const filename_invalid_ext = 'invalid_extension.exe'; // will be overwrite to docName
//   const fileCategory = 'CV';
//   var whoupdate = 'Editor';
//   var temp_name;
//   var file_name_inDB;
//   var messagesThreadId;
//   var student_1;
//   beforeEach(async () => {
//     protect.mockImplementation(async (req, res, next) => {
//       req.user = await User.findById(editor._id);
//       next();
//     });
//     const resp22 = await requestWithSupertest.post(
//       `/api/document-threads/init/general/${studentId}/${document_category}`
//     );
//     student_1 = resp22.body.data;
//     messagesThreadId = student_1.generaldocs_threads[0].doc_thread_id;
//   });

//   it.each([
//     ['my-file.exe', 400, false],
//     ['my-file.pdf', 201, true]
//   ])(
//     'should return 400 when program specific file type not .pdf .png, .jpg and .jpeg .docx %p %p %p',
//     async (File_Name, status, success) => {
//       const buffer_1MB_exe = Buffer.alloc(1024 * 1024 * 1); // 1 MB
//       const resp2 = await requestWithSupertest
//         .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
//         .attach('file', buffer_1MB_exe, File_Name);

//       expect(resp2.status).toBe(status);
//       expect(resp2.body.success).toBe(success);
//     }
//   );
//   it('should return 400 when editor general file (CV, RL) size over 5 MB', async () => {
//     const buffer_6MB = Buffer.alloc(1024 * 1024 * 6); // 6 MB
//     const resp2 = await requestWithSupertest
//       .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
//       .attach('file', buffer_6MB, filename);

//     expect(resp2.status).toBe(400);
//     expect(resp2.body.success).toBe(false);
//   });

//   it('should save the uploaded general CV,RL files and store the path in db', async () => {
//     const resp = await requestWithSupertest
//       .post(`/api/document-threads/${messagesThreadId}/${studentId}`)
//       .attach('file', Buffer.from('Lorem ipsum'), filename);

//     const { status, body } = resp;
//     expect(status).toBe(201);
//     expect(body.success).toBe(true);

//     var updatedStudent = await Student.findById(studentId)
//       .populate('applications.programId')
//       .lean()
//       .exec();

//     // Test Download:

//     const resp3 = await requestWithSupertest
//       .get(`/api/account/files/general/${studentId}/${whoupdate}/${temp_name}`)
//       .buffer();

//     expect(resp3.status).toBe(200);
//     expect(resp3.headers['content-disposition']).toEqual(
//       `attachment; filename="${temp_name}"`
//     );

//     var updated2Student = await Student.findById(studentId)
//       .populate('applications.programId')
//       .lean()
//       .exec();

//     // Mark as final documents
//     const resp6 = await requestWithSupertest.put(
//       `/api/account/files/general/${studentId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp6.status).toBe(201);
//     expect(resp6.body.success).toBe(true);
//     //TODO: check if it is really flagged with final: true

//     // test delete
//     const resp4 = await requestWithSupertest.delete(
//       `/api/account/files/general/${studentId}/${whoupdate}/${temp_name}`
//     );
//     expect(resp4.status).toBe(200);
//     expect(resp4.body.success).toBe(true);
//   });
// });

describe('POST /api/account/profile/:user_id', () => {
  const personaldata = { firstname: 'New_FirstName', lastname: 'New_LastName' };
  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      // req.user = await Student.findById(student._ìd);
      req.user = student;
      next();
    });
  });
  it('should update personal data', async () => {
    const resp = await requestWithSupertest
      .post(`/api/account/profile/${student._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ personaldata });
    const { status, body } = resp;
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // expect(body.data).toMatchObject({
    //   firstname: 'New_FirstName',
    //   lastname: 'New_LastName'
    // });
  });
});

describe('POST /api/account/survey/language', () => {
  const language = {
    english_certificate: 'TOEFL',
    english_score: '95',
    english_test_date: '',
    german_certificate: '',
    german_score: '',
    german_test_date: ''
  };

  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      // req.user = await User.findById(student._ìd);
      // TODO NOTE: req.user is strange here when using new mongoose version.
      req.user = student;
      next();
    });
  });

  it('should update language status', async () => {
    const resp = await requestWithSupertest
      .post(`/api/account/survey/language/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ language });
    const { status, body } = resp;
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // expect(body.data).toMatchObject(language_obj);
    expect(body.data.english_certificate).toBe(language.english_certificate);
    expect(body.data.english_score).toBe(language.english_score);
    expect(body.data.english_test_date).toBe(language.english_test_date);
    expect(body.data.german_certificate).toBe(language.german_certificate);
    expect(body.data.german_score).toBe(language.german_score);
    expect(body.data.german_test_date).toBe(language.german_test_date);
  });
});

describe('POST /api/account/survey/university', () => {
  const university = {
    attended_university: 'National Chiao Tung University',
    attended_university_program: 'Electronics Engineering',
    isGraduated: 'No'
  };
  beforeEach(async () => {
    protect.mockImplementation(async (req, res, next) => {
      // TODO NOTE: req.user is strange here when using new mongoose version.
      // req.user = await Student.findById(student._ìd);
      // req.user = await User.findById(admin._id);
      req.user = student;
      next();
    });
  });
  it('should update university (academic background) ', async () => {
    const resp = await requestWithSupertest
      .post(`/api/account/survey/university/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ university });
    const { status, body } = resp;

    expect(status).toBe(200);

    expect(body.success).toBe(true);
    expect(body.data.attended_university).toBe(university.attended_university);
    expect(body.data.attended_university_program).toBe(
      university.attended_university_program
    );
    expect(body.data.isGraduated).toBe(university.isGraduated);

    const resp2 = await requestWithSupertest
      .get('/api/account/survey')
      .set('tenantId', TENANT_ID);
    const university_body = resp2.body.data;
    expect(
      university_body.academic_background.university.attended_university
    ).toBe(university.attended_university);
    expect(
      university_body.academic_background.university.attended_university_program
    ).toBe(university.attended_university_program);
    expect(university_body.academic_background.university.isGraduated).toBe(
      university.isGraduated
    );
  });
});
