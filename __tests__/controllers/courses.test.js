const request = require('supertest');

const { connect, closeDatabase, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { generateCourse } = require('../fixtures/faker');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { coursesSchema } = require('../../models/Course');
const { users, student } = require('../mock/user');
const { app } = require('../../app');
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

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();

  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

const course1 = generateCourse(student._id);

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
  const CourseModel = db.model('Course', coursesSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await CourseModel.deleteMany();
  await CourseModel.insertMany([course1]);

  protect.mockImplementation(async (req, res, next) => {
    req.user = await UserModel.findById(student._id);
    next();
  });
});

describe('GET /api/courses/:studentId', () => {
  it('getMycourses', async () => {
    const resp = await requestWithSupertest
      .get(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.data.table_data_string).toContain('(Example)微積分一');
  });
});

describe('PUT /api/courses/:studentId', () => {
  it('putMycourses', async () => {
    const resp = await requestWithSupertest
      .put(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        table_data_string:
          '[{"course_chinese":"電子學一","course_english":"Electronics I","credits":"2","grades":"73"}]'
      });

    expect(resp.status).toEqual(200);
  });
});

describe('DELETE /api/courses/:studentId', () => {
  it('deleteMyCourse', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/courses/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
  });
});

// // TODO: uploading transcript for courses analyser
// describe('POST /api/courses/transcript/:studentId/:category/:group', () => {
//   it('should run python script on the uploaded file', async () => {
//     const pythonProcess = new EventEmitter();
//     spawn.mockImplementation((cmd, ...args) => {
//       setTimeout(() => pythonProcess.emit('close', 0), 0);
//       return pythonProcess;
//     });

//     const category = 'bachelorTranscript_';
//     const filename = 'my-file.xlsx';
//     const group = 'cs';

//     const resp = await requestWithSupertest
//       .post(`/api/courses/transcript/${studentId}/${category}/${group}`)
//       .set('tenantId', TENANT_ID)
//       .attach('file', Buffer.from('Lorem ipsum'), filename);

//     expect(spawn).toBeCalled();
//     expect(resp.status).toBe(200);
//     // FIXME: not a reasonable response
//     expect(resp.body).toMatchObject({ generatedfile: `analyzed_${filename}` });
//   });

//   it('should return 500 when error occurs while processing file', async () => {
//     const pythonProcess = new EventEmitter();
//     spawn.mockImplementation((cmd, ...args) => {
//       setTimeout(() => pythonProcess.emit('close', 1), 0);
//       return pythonProcess;
//     });

//     const category = 'bachelorTranscript_';
//     const filename = 'my-file.xlsx';
//     const group = 'cs';

//     const resp = await requestWithSupertest
//       .post(`/api/courses/transcript/${studentId}/${category}/${group}`)
//       .set('tenantId', TENANT_ID)
//       .attach('file', Buffer.from('Lorem ipsum'), filename);

//     expect(resp.status).toBe(500);
//   });

//   it.todo('should return 400 for invalid file');
// });

// describe("GET /api/courses/transcript/:studentId", () => {
//   it.todo("should download the analyzed report");
// });
