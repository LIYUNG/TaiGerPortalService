// Controller UNIT test for controllers/interviews.
//
// interviews is the "tangled" controller: a single handler can fan out to
// several services (Interview/Student/Application/Event/DocumentThread/
// Permission/Audit) plus side-effect modules (email, S3, informEditor). We call
// each handler DIRECTLY as a (req, res, next) function with ALL of those mocked
// and assert ONLY the controller's own work: the args it forwards, the status +
// body it writes, the guards/branching it does, and that a service error is
// forwarded to next(). No route, no middleware, no DB. The end-to-end coverage
// (route -> service -> dao -> in-memory Mongo) lives in
// __tests__/integration/interviews.test.js and the service/dao suites.

jest.mock('../../services/interviews');
jest.mock('../../services/students');
jest.mock('../../services/applications');
jest.mock('../../services/events');
jest.mock('../../services/documentthreads');
jest.mock('../../services/permissions');
jest.mock('../../services/audit');
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
jest.mock('../../utils/informEditor', () => ({
  addMessageInThread: jest.fn()
}));
jest.mock('../../utils/modelHelper/versionControl', () => ({
  // Preserve the real schema plugins (handleProgramChanges/enableVersionControl)
  // — models/Program.js applies them at require time. Only the S3 side effect is
  // stubbed so deleteInterview doesn't touch AWS.
  ...jest.requireActual('../../utils/modelHelper/versionControl'),
  emptyS3Directory: jest.fn()
}));
jest.mock('../../utils/queryFunctions', () => ({
  getPermission: jest.fn()
}));
jest.mock('../../utils/utils_function', () => ({
  userChangesHelperFunction: jest.fn().mockResolvedValue({
    addedUsers: [],
    removedUsers: [],
    updatedUsers: [],
    toBeInformedUsers: [],
    updatedUserIds: []
  })
}));

const InterviewService = require('../../services/interviews');
const StudentService = require('../../services/students');
const DocumentThreadService = require('../../services/documentthreads');
const PermissionService = require('../../services/permissions');
const AuditService = require('../../services/audit');
const {
  getInterview,
  getInterviewSurvey,
  updateInterviewSurvey,
  getAllOpenInterviews,
  getInterviewsByProgramId,
  getInterviewsByStudentId,
  getInterviewQuestions,
  deleteInterview,
  createInterview
} = require('../../controllers/interviews');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

const interviewId = '5f9f1b9b9c9d440000a1a1a1';
const programId = '5f9f1b9b9c9d440000b1b1b1';
const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
  // addInterviewStatus() (called by several handlers) only queries
  // distinctTrainedStudentIds for still-"Open" interviews; default to none.
  InterviewService.distinctTrainedStudentIds.mockResolvedValue([]);
});

describe('getInterview', () => {
  it('responds 200 with the interview (+ status) and its audit log', async () => {
    // isClosed => addInterviewStatus tags it "Closed" without extra queries.
    const interview = { _id: interviewId, isClosed: true };
    InterviewService.findInterviewByIdPopulated.mockResolvedValue(interview);
    const auditLog = [{ _id: 'a1' }];
    AuditService.getAuditLogs.mockResolvedValue(auditLog);
    const res = mockRes();

    await getInterview(
      mockReq({ params: { interview_id: interviewId } }),
      res,
      jest.fn()
    );

    expect(InterviewService.findInterviewByIdPopulated).toHaveBeenCalledWith(
      interviewId,
      expect.any(Array)
    );
    expect(AuditService.getAuditLogs).toHaveBeenCalledWith(
      { interviewThreadId: interviewId },
      { sort: { createdAt: -1 } }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ _id: interviewId, status: 'Closed' });
    expect(body.interviewAuditLog).toBe(auditLog);
  });

  it('forwards a 404 ErrorResponse to next() when the interview is not found', async () => {
    InterviewService.findInterviewByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await getInterview(
      mockReq({ params: { interview_id: interviewId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});

describe('getInterviewSurvey', () => {
  it('responds 200 with the survey resolved for req.params.interview_id', async () => {
    const survey = { _id: 's1', interview_id: interviewId };
    InterviewService.findOneSurvey.mockResolvedValue(survey);
    const res = mockRes();

    await getInterviewSurvey(
      mockReq({ params: { interview_id: interviewId } }),
      res,
      jest.fn()
    );

    expect(InterviewService.findOneSurvey).toHaveBeenCalledWith(
      { interview_id: interviewId },
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: survey });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    InterviewService.findOneSurvey.mockRejectedValue(err);
    const next = jest.fn();

    await getInterviewSurvey(
      mockReq({ params: { interview_id: interviewId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updateInterviewSurvey', () => {
  it('upserts the survey and responds 200 with it (non-final: no close, no emails)', async () => {
    const saved = { _id: 's1', interview_id: interviewId };
    InterviewService.upsertSurvey.mockResolvedValue(saved);
    const res = mockRes();

    await updateInterviewSurvey(
      mockReq({
        params: { interview_id: interviewId },
        body: { survey_result: 'passed' },
        user: admin
      }),
      res,
      jest.fn()
    );

    expect(InterviewService.upsertSurvey).toHaveBeenCalledWith(
      { interview_id: interviewId },
      { survey_result: 'passed' },
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: saved });
    // Non-final survey must not close the interview.
    expect(InterviewService.updateInterviewByIdRaw).not.toHaveBeenCalled();
  });

  it('final survey closes the interview after responding', async () => {
    InterviewService.upsertSurvey.mockResolvedValue({ _id: 's1' });
    // No trainers / archived student => no emails, no thread message.
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      student_id: {
        firstname: 'S',
        lastname: 'T',
        email: 's@t.c',
        archiv: true
      },
      trainer_id: []
    });
    const res = mockRes();

    await updateInterviewSurvey(
      mockReq({
        params: { interview_id: interviewId },
        body: { isFinal: true },
        user: admin
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(InterviewService.updateInterviewByIdRaw).toHaveBeenCalledWith(
      interviewId,
      { isClosed: true, status: 'Closed' }
    );
  });
});

describe('getAllOpenInterviews', () => {
  it('responds 200 with the open interviews (status-annotated)', async () => {
    InterviewService.findInterviews.mockResolvedValue([
      {
        _id: interviewId,
        isClosed: false,
        interview_date: new Date(Date.now() - 1000)
      }
    ]);
    const res = mockRes();

    await getAllOpenInterviews(mockReq(), res, jest.fn());

    expect(InterviewService.findInterviews).toHaveBeenCalledWith(
      { isClosed: false },
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data[0].status).toBe('Interviewed');
  });
});

describe('getInterviewsByProgramId', () => {
  it('400 when programId param is missing', async () => {
    const res = mockRes();

    await getInterviewsByProgramId(mockReq({ params: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: 'Program ID is required'
    });
  });

  it('200 with the aggregated, status-annotated interviews and a count', async () => {
    InterviewService.aggregateInterviews.mockResolvedValue([
      { _id: interviewId, isClosed: true, interview_date: new Date() }
    ]);
    const res = mockRes();

    await getInterviewsByProgramId(
      mockReq({ params: { programId } }),
      res,
      jest.fn()
    );

    expect(InterviewService.aggregateInterviews).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.data[0].status).toBe('Closed');
  });
});

describe('getInterviewsByStudentId', () => {
  it('400 when studentId param is missing', async () => {
    const res = mockRes();

    await getInterviewsByStudentId(mockReq({ params: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: 'Student ID is required'
    });
  });

  it('200 with the student interviews and a count, forwarding the studentId filter', async () => {
    InterviewService.findInterviews.mockResolvedValue([
      { _id: interviewId, isClosed: true }
    ]);
    const res = mockRes();

    await getInterviewsByStudentId(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(InterviewService.findInterviews).toHaveBeenCalledWith(
      { student_id: studentId },
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
  });
});

describe('getInterviewQuestions', () => {
  it('200 with only the surveys whose interview belongs to the requested program', async () => {
    InterviewService.findSurveys.mockResolvedValue([
      { _id: 'q1', interview_id: { program_id: programId } },
      { _id: 'q2', interview_id: { program_id: 'other-program' } }
    ]);
    const res = mockRes();

    await getInterviewQuestions(
      mockReq({ params: { programId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]._id).toBe('q1');
  });
});

describe('createInterview', () => {
  it('forwards a 400 ErrorResponse to next() when the student does not exist', async () => {
    StudentService.getStudentById.mockResolvedValue(null);
    const next = jest.fn();

    await createInterview(
      mockReq({ params: { program_id: programId, studentId }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(DocumentThreadService.createThread).not.toHaveBeenCalled();
  });

  it('forwards a 409 ErrorResponse to next() when an interview already exists', async () => {
    StudentService.getStudentById.mockResolvedValue({ _id: student._id });
    InterviewService.findOneInterview.mockResolvedValue({ _id: interviewId });
    const next = jest.fn();

    await createInterview(
      mockReq({ params: { program_id: programId, studentId }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(409);
    expect(DocumentThreadService.createThread).not.toHaveBeenCalled();
  });

  it('201: creates a thread + upserts the interview when none exists', async () => {
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'S',
      lastname: 'T',
      agents: []
    });
    InterviewService.findOneInterview
      .mockResolvedValueOnce(null) // existence pre-check
      .mockResolvedValueOnce({ _id: interviewId, program_id: programId }); // post-create read
    DocumentThreadService.createThread.mockResolvedValue({ _id: 'thread-1' });
    InterviewService.upsertInterviewPopulated.mockResolvedValue({});
    PermissionService.findPermissionsWithUser.mockResolvedValue([]);
    const res = mockRes();
    const body = { interviewer: 'Steve Jobs' };

    await createInterview(
      mockReq({ params: { program_id: programId, studentId }, body }),
      res,
      jest.fn()
    );

    expect(DocumentThreadService.createThread).toHaveBeenCalledWith({
      student_id: studentId,
      program_id: programId,
      file_type: 'Interview'
    });
    // thread_id is stamped onto the payload before upsert.
    expect(InterviewService.upsertInterviewPopulated).toHaveBeenCalledWith(
      { student_id: studentId, program_id: programId },
      expect.objectContaining({
        interviewer: 'Steve Jobs',
        thread_id: 'thread-1'
      }),
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});

describe('deleteInterview', () => {
  it('responds 200 after deleting the interview and its survey (no thread => no S3/event work)', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({
      _id: interviewId,
      isClosed: false,
      thread_id: ''
    });
    const res = mockRes();

    await deleteInterview(
      mockReq({ params: { interview_id: interviewId }, user: admin }),
      res,
      jest.fn()
    );

    expect(InterviewService.deleteInterviewById).toHaveBeenCalledWith(
      interviewId
    );
    expect(InterviewService.deleteOneSurvey).toHaveBeenCalledWith({
      interview_id: interviewId
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 403 ErrorResponse to next() when the interview is closed (precheck)', async () => {
    // PrecheckInterview reads the interview first; isClosed => 403.
    InterviewService.findByIdRaw.mockResolvedValue({
      _id: interviewId,
      isClosed: true
    });
    const next = jest.fn();

    await deleteInterview(
      mockReq({ params: { interview_id: interviewId }, user: admin }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(InterviewService.deleteInterviewById).not.toHaveBeenCalled();
  });
});
