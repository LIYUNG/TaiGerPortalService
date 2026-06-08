// Integration test for the interviews routes — HTTP boundary down to the
// services, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real controllers/interviews -> real services
//   (Interview/Student/DocumentThread/Permission/Audit) -> MOCKED DAOs.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. Outbound interview
// emails are stubbed (no SMTP in tests). The actual DB query/aggregate/populate
// construction is covered by the DAO unit tests.

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

// The data boundary: mock the DAOs the interview/related services delegate to.
jest.mock('../../dao/interview.dao');
jest.mock('../../dao/interviewSurveyResponse.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/documentthread.dao');
jest.mock('../../dao/permission.dao');
jest.mock('../../dao/audit.dao');

const request = require('supertest');
const InterviewDAO = require('../../dao/interview.dao');
const InterviewSurveyResponseDAO = require('../../dao/interviewSurveyResponse.dao');
const StudentDAO = require('../../dao/student.dao');
const DocumentthreadDAO = require('../../dao/documentthread.dao');
const PermissionDAO = require('../../dao/permission.dao');
const AuditDAO = require('../../dao/audit.dao');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { admin, student3 } = require('../mock/user');
const { app } = require('../../app');
const { interview1, interview3 } = require('../mock/interviews');
const { program4 } = require('../mock/programs');

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('POST /api/interviews/create/:program_id/:studentId', () => {
  it('creates an interview (and its document thread) via the DAOs', async () => {
    StudentDAO.getStudentById.mockResolvedValue({
      _id: student3._id,
      firstname: student3.firstname,
      lastname: student3.lastname,
      agents: []
    });
    // No existing interview for the pair -> creation proceeds.
    InterviewDAO.findOneInterview
      .mockResolvedValueOnce(null) // existence pre-check
      .mockResolvedValueOnce({
        // re-read after upsert (for the editor-lead email)
        _id: interview1._id,
        program_id: program4._id
      });
    DocumentthreadDAO.createThread.mockResolvedValue({ _id: interview1._id });
    InterviewDAO.upsertInterviewPopulated.mockResolvedValue({
      _id: interview1._id
    });
    PermissionDAO.findPermissionsWithUser.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .post(`/api/interviews/create/${program4._id}/${student3._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        interview_date: new Date(),
        interview_description: 'new-interview',
        interviewer: 'Steve Jobs'
      });

    expect(resp.status).toEqual(201);
    expect(resp.body.success).toBe(true);
    expect(StudentDAO.getStudentById).toHaveBeenCalledWith(
      student3._id.toString()
    );
    expect(InterviewDAO.findOneInterview).toHaveBeenCalledWith(
      {
        student_id: student3._id.toString(),
        program_id: program4._id.toString()
      },
      expect.any(Array)
    );
    expect(DocumentthreadDAO.createThread).toHaveBeenCalledWith({
      student_id: student3._id.toString(),
      program_id: program4._id.toString(),
      file_type: 'Interview'
    });
    // The freshly-created thread id is wired into the upserted interview.
    expect(InterviewDAO.upsertInterviewPopulated).toHaveBeenCalledWith(
      {
        student_id: student3._id.toString(),
        program_id: program4._id.toString()
      },
      expect.objectContaining({ thread_id: interview1._id.toString() }),
      expect.any(Array)
    );
  });

  it('returns 409 when an interview already exists for the student/program pair', async () => {
    StudentDAO.getStudentById.mockResolvedValue({
      _id: student3._id,
      firstname: student3.firstname,
      lastname: student3.lastname,
      agents: []
    });
    InterviewDAO.findOneInterview.mockResolvedValue({ _id: interview1._id });

    const resp = await requestWithSupertest
      .post(`/api/interviews/create/${program4._id}/${student3._id}`)
      .set('tenantId', TENANT_ID)
      .send({ interview_description: 'dup' });

    expect(resp.status).toEqual(409);
    expect(InterviewDAO.upsertInterviewPopulated).not.toHaveBeenCalled();
  });
});

describe('GET /api/interviews/:interview_id', () => {
  it('returns the interview from the DAO annotated with a status', async () => {
    // interview_date in the past => addInterviewStatus stamps "Interviewed"
    // without needing the distinctTrainedStudentIds lookup.
    InterviewDAO.findInterviewByIdPopulated.mockResolvedValue({
      _id: interview1._id,
      student_id: { _id: student3._id },
      interview_date: new Date('2000-01-01'),
      isClosed: false
    });
    AuditDAO.getAuditLogs.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get(`/api/interviews/${interview1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(interview1._id.toString());
    expect(resp.body.data.status).toBeDefined();
    expect(InterviewDAO.findInterviewByIdPopulated).toHaveBeenCalledWith(
      interview1._id.toString(),
      expect.any(Array)
    );
  });
});

describe('PUT /api/interviews/:interview_id', () => {
  it('updates the interview via the DAO and returns the saved record', async () => {
    // PrecheckInterview reads the raw interview; must not be closed.
    InterviewDAO.findByIdRaw.mockResolvedValue({ isClosed: false });
    InterviewDAO.findInterviewByIdPopulated.mockResolvedValue({
      _id: interview1._id,
      trainer_id: []
    });
    InterviewDAO.updateInterviewByIdPopulated.mockResolvedValue({
      _id: interview1._id,
      interview_description: 'modified_description',
      trainer_id: []
    });

    const resp = await requestWithSupertest
      .put(`/api/interviews/${interview1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ interview_description: 'modified_description' });

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.interview_description).toBe('modified_description');
    expect(InterviewDAO.updateInterviewByIdPopulated).toHaveBeenCalledWith(
      interview1._id.toString(),
      expect.objectContaining({
        interview_description: 'modified_description'
      }),
      expect.any(Array)
    );
  });
});

describe('DELETE /api/interviews/:interview_id', () => {
  it('deletes the interview (and its survey) via the DAOs', async () => {
    // No thread_id => the S3/event/thread branch is skipped.
    InterviewDAO.findByIdRaw.mockResolvedValue({
      isClosed: false,
      student_id: student3._id
    });
    InterviewDAO.deleteInterviewById.mockResolvedValue({ deletedCount: 1 });
    InterviewSurveyResponseDAO.deleteOneSurvey.mockResolvedValue({
      deletedCount: 0
    });

    const resp = await requestWithSupertest
      .delete(`/api/interviews/${interview3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(InterviewDAO.deleteInterviewById).toHaveBeenCalledWith(
      interview3._id.toString()
    );
    expect(InterviewSurveyResponseDAO.deleteOneSurvey).toHaveBeenCalledWith({
      interview_id: interview3._id.toString()
    });
  });
});

describe('GET /api/interviews/interviews/:studentId', () => {
  it('returns a success envelope with a count for the student', async () => {
    InterviewDAO.findInterviews.mockResolvedValue([
      {
        _id: interview1._id,
        student_id: { _id: student3._id },
        interview_date: new Date('2000-01-01'),
        isClosed: false
      }
    ]);

    const resp = await requestWithSupertest
      .get(`/api/interviews/interviews/${student3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(typeof resp.body.count).toBe('number');
    expect(InterviewDAO.findInterviews).toHaveBeenCalledWith(
      { student_id: student3._id.toString() },
      expect.any(Array)
    );
  });
});

describe('GET /api/interviews/:interview_id/survey', () => {
  it('returns the survey from the DAO (null when none exists)', async () => {
    InterviewSurveyResponseDAO.findOneSurvey.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/interviews/${interview1._id}/survey`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeNull();
    expect(InterviewSurveyResponseDAO.findOneSurvey).toHaveBeenCalledWith(
      { interview_id: interview1._id.toString() },
      expect.any(Array)
    );
  });
});

describe('PUT /api/interviews/:interview_id/survey', () => {
  it('upserts the survey via the DAO and returns it', async () => {
    const saved = {
      interview_id: interview1._id,
      survey_result: 'passed',
      notes: 'good performance'
    };
    InterviewSurveyResponseDAO.upsertSurvey.mockResolvedValue(saved);
    // The post-response re-read (for trainer notification) is not isFinal, so
    // the flow stops after fetching the interview.
    InterviewDAO.findInterviewByIdPopulated.mockResolvedValue({
      _id: interview1._id,
      student_id: { _id: student3._id },
      trainer_id: []
    });

    const put = await requestWithSupertest
      .put(`/api/interviews/${interview1._id}/survey`)
      .set('tenantId', TENANT_ID)
      .send({ survey_result: 'passed', notes: 'good performance' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.data.interview_id.toString()).toBe(
      interview1._id.toString()
    );
    expect(InterviewSurveyResponseDAO.upsertSurvey).toHaveBeenCalledWith(
      { interview_id: interview1._id.toString() },
      expect.objectContaining({ survey_result: 'passed' }),
      expect.any(Array)
    );
  });
});
