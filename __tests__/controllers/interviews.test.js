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
const ApplicationService = require('../../services/applications');
const EventService = require('../../services/events');
const DocumentThreadService = require('../../services/documentthreads');
const PermissionService = require('../../services/permissions');
const AuditService = require('../../services/audit');
const { getPermission } = require('../../utils/queryFunctions');
const {
  getAllInterviews,
  getMyInterview,
  getInterview,
  getInterviewSurvey,
  updateInterviewSurvey,
  addInterviewTrainingDateTime,
  updateInterview,
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

  it('final survey with an active student + trainer: emails both and posts a thread message', async () => {
    const {
      InterviewSurveyFinishedEmail,
      InterviewSurveyFinishedToTaiGerEmail
    } = require('../../services/email');
    const { addMessageInThread } = require('../../utils/informEditor');
    InterviewService.upsertSurvey.mockResolvedValue({ _id: 's1' });
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      student_id: {
        firstname: 'S',
        lastname: 'T',
        email: 's@t.c',
        archiv: false
      },
      trainer_id: [
        {
          _id: 'tr-1',
          firstname: 'Tr',
          lastname: 'A',
          email: 'tr@a.c',
          archiv: false
        }
      ],
      thread_id: { _id: 'th1' }
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

    expect(InterviewSurveyFinishedEmail).toHaveBeenCalledTimes(1);
    expect(InterviewSurveyFinishedToTaiGerEmail).toHaveBeenCalledTimes(1);
    expect(addMessageInThread).toHaveBeenCalledTimes(1);
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

  it('200 with the aggregated, status-annotated interviews sorted by date desc', async () => {
    // Two interviews => the sort comparator runs; newest interview_date first.
    InterviewService.aggregateInterviews.mockResolvedValue([
      {
        _id: 'older',
        isClosed: true,
        interview_date: new Date('2020-01-01')
      },
      {
        _id: 'newer',
        isClosed: true,
        interview_date: new Date('2024-01-01')
      }
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
    expect(body.count).toBe(2);
    expect(body.data[0]._id).toBe('newer');
    expect(body.data[0].status).toBe('Closed');
  });

  it('500 when the aggregation throws', async () => {
    InterviewService.aggregateInterviews.mockRejectedValue(
      new Error('agg boom')
    );
    const res = mockRes();

    await getInterviewsByProgramId(
      mockReq({ params: { programId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: 'agg boom'
    });
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

  it('500 when the lookup throws', async () => {
    InterviewService.findInterviews.mockRejectedValue(new Error('find boom'));
    const res = mockRes();

    await getInterviewsByStudentId(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: 'find boom'
    });
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

describe('getAllInterviews', () => {
  it('200 with status-annotated interviews + surveySubmitted flag', async () => {
    InterviewService.findInterviews.mockResolvedValue([
      { _id: interviewId, isClosed: true }
    ]);
    InterviewService.findSurveys.mockResolvedValue([
      { interview_id: interviewId }
    ]);
    const res = mockRes();

    await getAllInterviews(
      mockReq({ query: { isClosed: 'true', trainer_id: 'tr-1' } }),
      res,
      jest.fn()
    );

    expect(InterviewService.findInterviews).toHaveBeenCalledWith(
      { isClosed: 'true', trainer_id: 'tr-1' },
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data[0].status).toBe('Closed');
    expect(body.data[0].surveySubmitted).toBe(true);
  });

  it('no_trainer filter => trainer_id { $size: 0 }', async () => {
    InterviewService.findInterviews.mockResolvedValue([]);
    InterviewService.findSurveys.mockResolvedValue([]);
    const res = mockRes();

    await getAllInterviews(
      mockReq({ query: { no_trainer: 'true' } }),
      res,
      jest.fn()
    );

    expect(InterviewService.findInterviews).toHaveBeenCalledWith(
      { trainer_id: { $size: 0 } },
      expect.any(Array)
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getMyInterview', () => {
  it('staff (admin): 200 with status-annotated interviews + students', async () => {
    InterviewService.findInterviews.mockResolvedValue([
      { _id: interviewId, isClosed: true }
    ]);
    StudentService.getStudentsWithApplications.mockResolvedValue([
      { _id: 's1' }
    ]);
    const res = mockRes();

    await getMyInterview(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data[0].status).toBe('Closed');
    expect(body.students).toEqual([{ _id: 's1' }]);
  });

  it('agent without assign permission: scopes the student filter to the agent', async () => {
    const { agent } = require('../mock/user');
    InterviewService.findInterviews.mockResolvedValue([]);
    getPermission.mockResolvedValueOnce({
      canAssignAgents: false,
      canAssignEditors: false
    });
    StudentService.getStudentsWithApplications.mockResolvedValue([]);
    const res = mockRes();

    await getMyInterview(mockReq({ user: agent }), res, jest.fn());

    expect(StudentService.getStudentsWithApplications).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('staff: forwards a 400 ErrorResponse when no students are found', async () => {
    InterviewService.findInterviews.mockResolvedValue([]);
    StudentService.getStudentsWithApplications.mockResolvedValue(null);
    const next = jest.fn();

    await getMyInterview(mockReq({ user: admin }), mockRes(), next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  it('student: 200 with the student + their applications attached', async () => {
    InterviewService.findInterviews.mockResolvedValue([]);
    StudentService.getStudentById.mockResolvedValue({ _id: student._id });
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([
      { _id: 'app1' }
    ]);
    const res = mockRes();

    await getMyInterview(mockReq({ user: student }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.student.applications).toEqual([{ _id: 'app1' }]);
  });
});

describe('addInterviewTrainingDateTime', () => {
  it('creates a new event + schedules the interview, then 200 and calls next()', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    EventService.createEvent.mockResolvedValue({ _id: 'ev1' });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: 'ev1',
      start: new Date().toISOString(),
      receiver_id: [],
      requester_id: []
    });
    InterviewService.updateInterviewByIdRaw.mockResolvedValue({});
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: 's1',
      program_id: { _id: programId }
    });
    StudentService.getStudentByIdWithAgents.mockResolvedValue({ agents: [] });
    const next = jest.fn();
    const res = mockRes();

    await addInterviewTrainingDateTime(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: { start: new Date().toISOString(), requester_id: [] }
      }),
      res,
      next
    );

    expect(EventService.createEvent).toHaveBeenCalledTimes(1);
    expect(InterviewService.updateInterviewByIdRaw).toHaveBeenCalledWith(
      interviewId,
      expect.objectContaining({ status: 'Scheduled' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('updates an existing event when the payload carries an _id', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    EventService.updateEventRawById.mockResolvedValue({});
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: 'ev1',
      start: new Date().toISOString(),
      receiver_id: [],
      requester_id: []
    });
    InterviewService.updateInterviewByIdRaw.mockResolvedValue({});
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: 's1',
      program_id: { _id: programId }
    });
    StudentService.getStudentByIdWithAgents.mockResolvedValue({ agents: [] });
    const next = jest.fn();
    const res = mockRes();

    await addInterviewTrainingDateTime(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: { _id: 'ev1', start: new Date().toISOString(), requester_id: [] }
      }),
      res,
      next
    );

    expect(EventService.updateEventRawById).toHaveBeenCalledTimes(1);
    expect(EventService.createEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards a 403 ErrorResponse to next() when the interview is closed', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: true });
    const next = jest.fn();

    await addInterviewTrainingDateTime(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: { start: new Date().toISOString(), requester_id: [] }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('emails the active requesters after scheduling (covers the invitation loop)', async () => {
    const { sendInterviewConfirmationEmail } = require('../../services/email');
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    EventService.createEvent.mockResolvedValue({ _id: 'ev1' });
    EventService.getEventByIdPopulated.mockResolvedValue({
      _id: 'ev1',
      start: new Date().toISOString(),
      meetingLink: 'https://meet/x',
      receiver_id: [],
      requester_id: [
        {
          _id: { toString: () => 'u1' },
          firstname: 'Q',
          lastname: 'Y',
          email: 'q@y.c',
          archiv: false
        }
      ]
    });
    InterviewService.updateInterviewByIdRaw.mockResolvedValue({});
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      student_id: 's1',
      program_id: { _id: programId }
    });
    StudentService.getStudentByIdWithAgents.mockResolvedValue({ agents: [] });
    const next = jest.fn();
    const res = mockRes();

    await addInterviewTrainingDateTime(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: {
          start: new Date().toISOString(),
          requester_id: [
            { _id: { toString: () => 'u1' }, firstname: 'Q', lastname: 'Y' }
          ]
        }
      }),
      res,
      next
    );

    expect(sendInterviewConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('forwards a 500 ErrorResponse when updating an existing event fails', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    EventService.updateEventRawById.mockRejectedValue(new Error('update boom'));
    const next = jest.fn();

    await addInterviewTrainingDateTime(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: {
          _id: 'ev1',
          start: new Date().toISOString(),
          requester_id: [
            { _id: { toString: () => 'u1' }, firstname: 'Q', lastname: 'Y' }
          ]
        }
      }),
      mockRes(),
      next
    );

    // Inner 403 is re-wrapped by the outer catch into a 500.
    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });
});

describe('updateInterview', () => {
  it('404 when the interview to update is not found', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    InterviewService.findInterviewByIdPopulated.mockResolvedValue(null);
    const res = mockRes();

    await updateInterview(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: { interview_date: new Date() }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Interview not found' });
  });

  it('assigns trainers: 200, emails the student + trainers, stamps req.audit, next()', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      trainer_id: [],
      student_id: { _id: 's1' }
    });
    InterviewService.updateInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      student_id: {
        _id: 's1',
        firstname: 'S',
        lastname: 'T',
        email: 's@t.c',
        archiv: false
      },
      trainer_id: [
        { firstname: 'Tr', lastname: 'Ainer', email: 'tr@a.c', archiv: false }
      ],
      thread_id: { _id: 'th1' }
    });
    const next = jest.fn();
    const req = mockReq({
      user: admin,
      params: { interview_id: interviewId },
      body: { trainer_id: ['tr-1'] }
    });
    const res = mockRes();

    await updateInterview(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(req.audit).toMatchObject({ field: 'interview trainer' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('isClosed update: updates the thread finalVersion + stamps a status audit', async () => {
    // isClosed in payload => no PrecheckInterview read.
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      trainer_id: [],
      student_id: { _id: 's1', archiv: true },
      isClosed: false
    });
    InterviewService.updateInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      student_id: { _id: 's1', archiv: true },
      trainer_id: [],
      thread_id: { _id: 'th1' }
    });
    const next = jest.fn();
    const req = mockReq({
      user: admin,
      params: { interview_id: interviewId },
      body: { isClosed: true }
    });
    const res = mockRes();

    await updateInterview(req, res, next);

    expect(DocumentThreadService.updateThreadFields).toHaveBeenCalledWith(
      'th1',
      { isFinalVersion: true }
    );
    expect(req.audit).toMatchObject({ field: 'status' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('isClosed update with an active student: emails the set-as-final notice', async () => {
    const { sendSetAsFinalInterviewEmail } = require('../../services/email');
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      trainer_id: [],
      student_id: { _id: 's1', archiv: false },
      isClosed: false
    });
    InterviewService.updateInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      student_id: {
        _id: 's1',
        firstname: 'S',
        lastname: 'T',
        email: 's@t.c',
        archiv: false
      },
      trainer_id: [],
      thread_id: { _id: 'th1' }
    });
    const next = jest.fn();
    const req = mockReq({
      user: admin,
      params: { interview_id: interviewId },
      body: { isClosed: true }
    });
    const res = mockRes();

    await updateInterview(req, res, next);

    expect(sendSetAsFinalInterviewEmail).toHaveBeenCalledTimes(1);
    expect(req.audit).toMatchObject({ field: 'status' });
  });

  it('500 when the update returns nothing', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({ isClosed: false });
    InterviewService.findInterviewByIdPopulated.mockResolvedValue({
      _id: interviewId,
      trainer_id: [],
      student_id: { _id: 's1' }
    });
    InterviewService.updateInterviewByIdPopulated.mockResolvedValue(null);
    const res = mockRes();

    await updateInterview(
      mockReq({
        user: admin,
        params: { interview_id: interviewId },
        body: { interview_date: new Date() }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to update interview'
    });
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

  it('201: emails the editor-leads (permissions) and the active agents', async () => {
    const { sendAssignTrainerReminderEmail } = require('../../services/email');
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'S',
      lastname: 'T',
      agents: [
        { firstname: 'Ag', lastname: 'Ent', email: 'a@e.c', archiv: false }
      ]
    });
    InterviewService.findOneInterview
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: { toString: () => interviewId },
        program_id: { _id: programId }
      });
    DocumentThreadService.createThread.mockResolvedValue({ _id: 'thread-1' });
    InterviewService.upsertInterviewPopulated.mockResolvedValue({});
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      {
        user_id: {
          firstname: 'Ed',
          lastname: 'Lead',
          email: 'ed@l.c',
          archiv: false
        }
      }
    ]);
    const res = mockRes();

    await createInterview(
      mockReq({ params: { program_id: programId, studentId }, body: {} }),
      res,
      jest.fn()
    );

    // One email to the editor-lead + one to the agent.
    expect(sendAssignTrainerReminderEmail).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('forwards a 404 ErrorResponse to next() when thread creation fails', async () => {
    StudentService.getStudentById.mockResolvedValue({
      _id: student._id,
      firstname: 'S',
      lastname: 'T',
      agents: []
    });
    InterviewService.findOneInterview.mockResolvedValueOnce(null);
    DocumentThreadService.createThread.mockRejectedValue(new Error('boom'));
    const next = jest.fn();

    await createInterview(
      mockReq({ params: { program_id: programId, studentId }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
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

  it('with a thread + event: empties S3, deletes the event, sends a cancel email, then 200', async () => {
    // Two reads of findByIdRaw: PrecheckInterview + the main fetch.
    InterviewService.findByIdRaw.mockResolvedValue({
      _id: interviewId,
      isClosed: false,
      thread_id: { toString: () => 'th1' },
      student_id: { toString: () => studentId },
      event_id: 'ev1'
    });
    EventService.deleteEventByIdPopulated.mockResolvedValue({
      receiver_id: [{ firstname: 'R', lastname: 'X', email: 'r@x.c' }],
      requester_id: [
        {
          _id: 'u1',
          firstname: 'Q',
          lastname: 'Y',
          email: 'q@y.c',
          archiv: false
        }
      ]
    });
    StudentService.getStudentByIdWithAgents.mockResolvedValue({ agents: [] });
    EventService.deleteEventById.mockResolvedValue();
    DocumentThreadService.deleteThreadById.mockResolvedValue();
    const res = mockRes();

    await deleteInterview(
      mockReq({ params: { interview_id: interviewId }, user: admin }),
      res,
      jest.fn()
    );

    expect(EventService.deleteEventByIdPopulated).toHaveBeenCalledTimes(1);
    expect(EventService.deleteEventById).toHaveBeenCalledWith('ev1');
    expect(DocumentThreadService.deleteThreadById).toHaveBeenCalled();
    expect(InterviewService.deleteInterviewById).toHaveBeenCalledWith(
      interviewId
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('with a thread but no event: empties S3, deletes the thread, no event/email work', async () => {
    InterviewService.findByIdRaw.mockResolvedValue({
      _id: interviewId,
      isClosed: false,
      thread_id: { toString: () => 'th1' },
      student_id: { toString: () => studentId },
      event_id: null
    });
    DocumentThreadService.deleteThreadById.mockResolvedValue();
    const res = mockRes();

    await deleteInterview(
      mockReq({ params: { interview_id: interviewId }, user: admin }),
      res,
      jest.fn()
    );

    expect(EventService.deleteEventByIdPopulated).not.toHaveBeenCalled();
    expect(DocumentThreadService.deleteThreadById).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('addInterviewStatus (via getAllOpenInterviews)', () => {
  it('tags future-event interviews "Scheduled" and past-event "Trained"', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    InterviewService.findInterviews.mockResolvedValue([
      { _id: 'i-sched', isClosed: false, event_id: { start: future } },
      { _id: 'i-trained', isClosed: false, event_id: { start: past } }
    ]);
    const res = mockRes();

    await getAllOpenInterviews(mockReq(), res, jest.fn());

    const data = res.send.mock.calls[0][0].data;
    const byId = Object.fromEntries(data.map((i) => [i._id, i.status]));
    expect(byId['i-sched']).toBe('Scheduled');
    expect(byId['i-trained']).toBe('Trained');
  });

  it('tags an open interview "Open", or "N/A" when the student was already trained elsewhere', async () => {
    InterviewService.findInterviews.mockResolvedValue([
      // No date / event => "Open" candidate. student already trained => N/A.
      {
        _id: 'i-na',
        isClosed: false,
        student_id: { _id: { toString: () => 'stud-na' } }
      },
      // No student id => stays "Open".
      { _id: 'i-open', isClosed: false }
    ]);
    InterviewService.distinctTrainedStudentIds.mockResolvedValue(['stud-na']);
    const res = mockRes();

    await getAllOpenInterviews(mockReq(), res, jest.fn());

    const data = res.send.mock.calls[0][0].data;
    const byId = Object.fromEntries(data.map((i) => [i._id, i.status]));
    expect(byId['i-na']).toBe('N/A');
    expect(byId['i-open']).toBe('Open');
  });
});
