// Full-stack integration layer for the interviews routes:
//   supertest -> real router -> real controllers/interviews -> real services
//   (Interview/Student/Event/DocumentThread/Permission/Audit) -> real DAOs ->
//   in-memory MongoDB.
//
// Only auth/tenant middleware is stubbed and the outbound email service is
// stubbed (no SMTP in tests). Everything below the route is real, so a seam bug
// (schema/query/populate/aggregate) surfaces here. Kept thin — exhaustive
// per-handler behaviour lives in ../controllers/interviews.test.js (mocked) and
// the service/dao suites.

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
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});
jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});
jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});
jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});
// No SMTP in tests: stub every interview email used by the controller.
jest.mock('../../services/email', () => ({
  sendInterviewConfirmationEmail: jest.fn(),
  sendAssignTrainerReminderEmail: jest.fn(),
  sendAssignedInterviewTrainerToTrainerEmail: jest.fn(),
  sendAssignedInterviewTrainerToStudentEmail: jest.fn(),
  InterviewCancelledReminderEmail: jest.fn(),
  sendSetAsFinalInterviewEmail: jest.fn(),
  InterviewSurveyFinishedEmail: jest.fn(),
  InterviewSurveyFinishedToTaiGerEmail: jest.fn()
}));

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { interviewsSchema } = require('../../models/Interview');
const { users, admin, student3 } = require('../mock/user');
const { app } = require('../../app');
const { interviews, interview1, interview3 } = require('../mock/interviews');
const { program4 } = require('../mock/programs');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);
let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const InterviewModel = db.model('Interview', interviewsSchema);

  await UserModel.deleteMany();
  await UserModel.insertMany(users);
  await InterviewModel.deleteMany();
  await InterviewModel.insertMany(interviews);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('POST /api/interviews/create/:program_id/:studentId (full stack)', () => {
  it('creates an interview (and its document thread) and persists it', async () => {
    const resp = await requestWithSupertest
      .post(`/api/interviews/create/${program4._id}/${student3._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        student_id: student3._id,
        program_id: program4._id,
        interview_date: new Date(),
        interview_description: 'new-interview',
        interviewer: 'Steve Jobs'
      });

    expect(resp.status).toEqual(201);
    expect(resp.body.success).toBe(true);

    // The interview is actually persisted for the student/program pair, with a
    // freshly-created thread_id wired in.
    const db = connectToDatabase(TENANT_ID, dbUri);
    const InterviewModel = db.model('Interview', interviewsSchema);
    const stored = await InterviewModel.findOne({
      student_id: student3._id,
      program_id: program4._id
    }).lean();
    expect(stored).toBeTruthy();
    expect(stored.thread_id).toBeTruthy();
  });

  it('returns 409 when an interview already exists for the student/program pair', async () => {
    const resp = await requestWithSupertest
      .post(
        `/api/interviews/create/${interview1.program_id}/${interview1.student_id}`
      )
      .set('tenantId', TENANT_ID)
      .send({ interview_description: 'dup' });

    expect(resp.status).toEqual(409);
  });
});

describe('GET /api/interviews/:interview_id (full stack)', () => {
  it('returns the persisted interview annotated with a status', async () => {
    const resp = await requestWithSupertest
      .get(`/api/interviews/${interview1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(interview1._id.toString());
    // addInterviewStatus always stamps a status onto the returned interview.
    expect(resp.body.data.status).toBeDefined();
  });
});

describe('PUT /api/interviews/:interview_id (full stack)', () => {
  it('updates the interview and the change persists', async () => {
    const resp = await requestWithSupertest
      .put(`/api/interviews/${interview1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ interview_description: 'modified_description' });

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.interview_description).toBe('modified_description');

    const db = connectToDatabase(TENANT_ID, dbUri);
    const InterviewModel = db.model('Interview', interviewsSchema);
    const reloaded = await InterviewModel.findById(interview1._id).lean();
    expect(reloaded.interview_description).toBe('modified_description');
  });
});

describe('DELETE /api/interviews/:interview_id (full stack)', () => {
  it('deletes the interview from the database', async () => {
    const resp = await requestWithSupertest
      .delete(`/api/interviews/${interview3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);

    const db = connectToDatabase(TENANT_ID, dbUri);
    const InterviewModel = db.model('Interview', interviewsSchema);
    const reloaded = await InterviewModel.findById(interview3._id).lean();
    expect(reloaded).toBeNull();
  });
});

describe('GET /api/interviews/interviews/:studentId (full stack)', () => {
  it('returns a success envelope with a count for the student', async () => {
    const resp = await requestWithSupertest
      .get(`/api/interviews/interviews/${student3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(typeof resp.body.count).toBe('number');
  });
});

describe('GET /api/interviews/:interview_id/survey (full stack)', () => {
  it('returns a success envelope (no survey seeded => data is null)', async () => {
    const resp = await requestWithSupertest
      .get(`/api/interviews/${interview1._id}/survey`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeNull();
  });
});

describe('PUT /api/interviews/:interview_id/survey (full stack)', () => {
  it('upserts a survey and the change is visible on a subsequent read', async () => {
    const put = await requestWithSupertest
      .put(`/api/interviews/${interview1._id}/survey`)
      .set('tenantId', TENANT_ID)
      .send({ survey_result: 'passed', notes: 'good performance' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await requestWithSupertest
      .get(`/api/interviews/${interview1._id}/survey`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(200);
    expect(get.body.data).not.toBeNull();
    expect(get.body.data.interview_id.toString()).toBe(
      interview1._id.toString()
    );
  });
});
