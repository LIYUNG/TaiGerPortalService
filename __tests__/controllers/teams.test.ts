// Controller UNIT test for controllers/teams.
//
// teams is the "tangled" controller: a single handler can fan out to several
// services (Team/Student/User/Permission/Interview/DocumentThread). We call each
// handler DIRECTLY as a (req, res, next) function with all of those services
// mocked, and assert ONLY the controller's own work: the args it forwards, the
// status + body it writes, and the counting/branching it does. No route, no
// middleware, no DB. The heavy aggregation against a real DB lives in
// __tests__/integration/teams.test.js and the service/dao suites.

jest.mock('../../services/teams');
jest.mock('../../services/students');
jest.mock('../../services/users');
jest.mock('../../services/permissions');
jest.mock('../../services/interviews');
jest.mock('../../services/documentthreads');
jest.mock('../../services/programs');
jest.mock('../../controllers/programs', () => ({
  getStudentsByProgram: jest.fn()
}));
jest.mock('../../utils/modelHelper/programChange', () => ({
  findStudentDeltaGet: jest.fn()
}));

const TeamService = require('../../services/teams');
const StudentService = require('../../services/students');
const UserService = require('../../services/users');
const PermissionService = require('../../services/permissions');
const InterviewService = require('../../services/interviews');
const DocumentThreadService = require('../../services/documentthreads');
const ProgramService = require('../../services/programs');
const { getStudentsByProgram } = require('../../controllers/programs');
const {
  findStudentDeltaGet
} = require('../../utils/modelHelper/programChange');
const { ten_minutes_cache } = require('../../cache/node-cache');
const {
  getTeamMembers,
  getIsManager,
  getTasksOverview,
  getResponseTimeByStudent,
  getResponseIntervalByStudent,
  getArchivStudents,
  getApplicationDeltas,
  getStatisticsKPI,
  getStatisticsOverview,
  getStatisticsAgents,
  getStatisticsResponseTime,
  getAgentProfile,
  putAgentProfile
} = require('../../controllers/teams');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, agent } = require('../mock/user');

beforeEach(() => {
  jest.clearAllMocks();
  // Statistics handlers memoise into a node-cache singleton; flush it so each
  // test computes fresh from its own mocks.
  ten_minutes_cache.flushAll();
});

describe('getTeamMembers', () => {
  it('responds 200 with the members from the service', async () => {
    const members = [{ _id: 'u1', firstname: 'Ann' }];
    TeamService.getTeamMembers.mockResolvedValue(members);
    const res = mockRes();

    await getTeamMembers(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: members });
  });
});

describe('getIsManager', () => {
  it('derives isManager from the permission and forwards req.user._id', async () => {
    PermissionService.getPermissionByUserId.mockResolvedValue({
      canAssignAgents: true,
      canAssignEditors: false
    });
    const res = mockRes();

    await getIsManager(mockReq({ user: agent }), res, jest.fn());

    expect(PermissionService.getPermissionByUserId).toHaveBeenCalledWith(
      agent._id
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { isManager: true }
    });
  });

  it('isManager is falsy when there is no permission record', async () => {
    PermissionService.getPermissionByUserId.mockResolvedValue(null);
    const res = mockRes();

    await getIsManager(mockReq({ user: agent }), res, jest.fn());

    const body = res.send.mock.calls[0][0];
    expect(body.data.isManager).toBeFalsy();
  });

  it('isManager is falsy when the user can assign neither', async () => {
    PermissionService.getPermissionByUserId.mockResolvedValue({
      canAssignAgents: false,
      canAssignEditors: false
    });
    const res = mockRes();

    await getIsManager(mockReq({ user: agent }), res, jest.fn());

    const body = res.send.mock.calls[0][0];
    expect(body.data.isManager).toBeFalsy();
  });
});

describe('getTasksOverview', () => {
  it('counts the lists each service returns', async () => {
    StudentService.fetchStudents
      .mockResolvedValueOnce([{}, {}]) // no-agent students
      .mockResolvedValueOnce([{}]); // no-editor students
    InterviewService.getInterviews.mockResolvedValue([{}, {}, {}]);
    DocumentThreadService.getAllStudentsThreads.mockResolvedValue([]);
    const res = mockRes();

    await getTasksOverview(mockReq({ user: agent }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: {
        noAgentsStudents: 2,
        noEditorsStudents: 1,
        noTrainerInInterviewsStudents: 3,
        noEssayWritersEssays: 0
      }
    });
  });
});

describe('getResponseTimeByStudent', () => {
  it('responds 200 with the records and forwards req.params.studentId', async () => {
    const records = [{ _id: 'r1', interval: 12 }];
    TeamService.getResponseTimesByStudent.mockResolvedValue(records);
    const res = mockRes();

    await getResponseTimeByStudent(
      mockReq({ params: { studentId: 'stud-1' } }),
      res,
      jest.fn()
    );

    expect(TeamService.getResponseTimesByStudent).toHaveBeenCalledWith(
      'stud-1'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: records });
  });
});

describe('getArchivStudents', () => {
  it('Admin branch: fetches all archived students', async () => {
    UserService.getUserById.mockResolvedValue({ role: 'Admin' });
    const archived = [{ _id: 's1' }];
    StudentService.findStudentsWithTeamNames.mockResolvedValue(archived);
    const res = mockRes();

    await getArchivStudents(
      mockReq({ params: { TaiGerStaffId: admin._id.toString() } }),
      res,
      jest.fn()
    );

    expect(StudentService.findStudentsWithTeamNames).toHaveBeenCalledWith({
      archiv: true
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: archived });
  });
});

describe('getStatisticsKPI', () => {
  it('responds 200 with finished_docs from the service', async () => {
    const finished = [{ month: '2026-01', count: 4 }];
    TeamService.getKpiFinishedDocs.mockResolvedValue(finished);
    const res = mockRes();

    await getStatisticsKPI(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      finished_docs: finished
    });
  });
});

describe('getStatisticsOverview', () => {
  it('responds 200 with empty agent/editor data when there is no staff', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    TeamService.getFileTypeCounts.mockResolvedValue({
      counts1: [],
      counts2: []
    });
    TeamService.getStudentsCreationData.mockResolvedValue([]);
    TeamService.getEditorTaskRows.mockResolvedValue([]);
    const res = mockRes();

    await getStatisticsOverview(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.agents_data).toEqual([]);
    expect(body.editors_data).toEqual([]);
  });
});

describe('getStatisticsAgents', () => {
  it('responds 200 with an empty distribution when there are no agents', async () => {
    UserService.findAgents.mockResolvedValue([]);
    const res = mockRes();

    await getStatisticsAgents(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.agentStudentDistribution).toEqual([]);
  });
});

describe('getStatisticsResponseTime', () => {
  it('responds 200 with the average response time from the service', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    TeamService.getStudentAvgResponseTime.mockResolvedValue([{ avg: 3 }]);
    const res = mockRes();

    await getStatisticsResponseTime(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.studentAvgResponseTime).toEqual([{ avg: 3 }]);
  });
});

describe('getAgentProfile / putAgentProfile', () => {
  it('getAgentProfile responds 200 and forwards id + projection', async () => {
    const profile = { firstname: 'Joe', lastname: 'Doe' };
    UserService.findAgentById.mockResolvedValue(profile);
    const res = mockRes();

    await getAgentProfile(
      mockReq({ params: { agent_id: 'agent-1' } }),
      res,
      jest.fn()
    );

    expect(UserService.findAgentById).toHaveBeenCalledWith(
      'agent-1',
      'firstname lastname email selfIntroduction officehours timezone'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: profile });
  });

  it('putAgentProfile responds 200 with the agent', async () => {
    const profile = { firstname: 'Joe' };
    UserService.findAgentById.mockResolvedValue(profile);
    const res = mockRes();

    await putAgentProfile(
      mockReq({ params: { agent_id: 'agent-1' }, body: { firstname: 'Joe' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: profile });
  });
});

describe('getApplicationDeltas', () => {
  it('responds 200 with [] when there are no active programs', async () => {
    TeamService.getActivePrograms.mockResolvedValue([]);
    const res = mockRes();

    await getApplicationDeltas(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    TeamService.getActivePrograms.mockRejectedValue(err);
    const next = jest.fn();

    await getApplicationDeltas(mockReq({ user: admin }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('200: returns per-program student deltas for an active program', async () => {
    const programId = 'prog-1';
    TeamService.getActivePrograms.mockResolvedValue([{ _id: programId }]);
    getStudentsByProgram.mockResolvedValue([
      { _id: 'stu-1', firstname: 'A', lastname: 'B', closed: '-' }
    ]);
    ProgramService.getProgramByIdLean.mockResolvedValue({
      _id: programId,
      school: 'MIT',
      program_name: 'CS',
      degree: 'MSc',
      semester: 'WS'
    });
    findStudentDeltaGet.mockResolvedValue({
      add: [{ _id: 'x' }],
      remove: []
    });
    const res = mockRes();

    await getApplicationDeltas(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    expect(body.data[0].program.school).toBe('MIT');
    expect(body.data[0].students[0]._id).toBe('stu-1');
  });

  it('200: skips students with empty deltas and closed students', async () => {
    const programId = 'prog-1';
    TeamService.getActivePrograms.mockResolvedValue([{ _id: programId }]);
    getStudentsByProgram.mockResolvedValue([
      { _id: 'stu-1', firstname: 'A', lastname: 'B', closed: '-' },
      { _id: 'stu-2', firstname: 'C', lastname: 'D', closed: 'O' } // closed -> skipped
    ]);
    ProgramService.getProgramByIdLean.mockResolvedValue({
      _id: programId,
      school: 'MIT',
      program_name: 'CS'
    });
    // empty add/remove -> getStudentDeltas returns undefined -> filtered out
    findStudentDeltaGet.mockResolvedValue({ add: [], remove: [] });
    const res = mockRes();

    await getApplicationDeltas(mockReq({ user: admin }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    // no deltas -> program returns {} -> filtered out of the response
    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

describe('getStatisticsOverview (editor rows + task counts)', () => {
  it('builds editor data with active/potential task counts', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([
      { _id: 'ed-1', firstname: 'Ed', lastname: 'It' }
    ]);
    StudentService.countStudents.mockResolvedValue(5);
    TeamService.getFileTypeCounts.mockResolvedValue({
      counts1: [],
      counts2: []
    });
    TeamService.getStudentsCreationData.mockResolvedValue([]);
    TeamService.getEditorTaskRows.mockResolvedValue([
      { editor_id: 'ed-1', isFinalVersion: false, show: true },
      {
        editor_id: 'ed-1',
        isFinalVersion: false,
        show: false,
        isPotentials: true
      },
      { editor_id: 'ed-1', isFinalVersion: true, show: true } // completed -> not counted
    ]);
    const res = mockRes();

    await getStatisticsOverview(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.editors_data).toHaveLength(1);
    expect(body.editors_data[0].student_num).toBe(5);
    expect(body.editors_data[0].task_counts).toEqual({
      active: 1,
      potentials: 1
    });
  });
});

describe('getResponseIntervalByStudent', () => {
  it('groups interval records by thread and attaches them to applications', async () => {
    StudentService.getStudentApplicationsForIntervals.mockResolvedValue({
      applications: [
        {
          programId: { _id: 'p1', school: 'X' },
          doc_modification_thread: [{ doc_thread_id: 'th1' }]
        }
      ]
    });
    TeamService.getIntervals.mockResolvedValue([
      { thread_id: 'th1', interval_type: 'doc', value: 5 },
      { interval_type: 'communication', value: 3 }
    ]);
    const res = mockRes();

    await getResponseIntervalByStudent(
      mockReq({ params: { studentId: 'stud-1' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.applications[0].threadIntervals).toBeDefined();
    expect(body.data.communicationThreadIntervals).toBeDefined();
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('boom');
    StudentService.getStudentApplicationsForIntervals.mockRejectedValue(err);
    const next = jest.fn();

    await getResponseIntervalByStudent(
      mockReq({ params: { studentId: 'stud-1' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getArchivStudents (role branches)', () => {
  it('agent branch: scopes the archived students to the agent', async () => {
    UserService.getUserById.mockResolvedValue(agent);
    StudentService.findStudentsWithTeamNames.mockResolvedValue([{ _id: 's1' }]);
    const res = mockRes();

    await getArchivStudents(
      mockReq({ params: { TaiGerStaffId: agent._id.toString() } }),
      res,
      jest.fn()
    );

    expect(StudentService.findStudentsWithTeamNames).toHaveBeenCalledWith(
      expect.objectContaining({ agents: agent._id.toString(), archiv: true })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('editor branch: scopes the archived students to the editor', async () => {
    UserService.getUserById.mockResolvedValue({ role: 'Editor' });
    StudentService.findStudentsWithTeamNames.mockResolvedValue([]);
    const res = mockRes();

    await getArchivStudents(
      mockReq({ params: { TaiGerStaffId: 'ed-1' } }),
      res,
      jest.fn()
    );

    expect(StudentService.findStudentsWithTeamNames).toHaveBeenCalledWith(
      expect.objectContaining({ editors: 'ed-1', archiv: true })
    );
  });

  it('guest branch: responds 200 with an empty list', async () => {
    UserService.getUserById.mockResolvedValue({ role: 'Guest' });
    const res = mockRes();

    await getArchivStudents(
      mockReq({ params: { TaiGerStaffId: 'g-1' } }),
      res,
      jest.fn()
    );

    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
    expect(StudentService.findStudentsWithTeamNames).not.toHaveBeenCalled();
  });
});

describe('getStatisticsOverview (with staff)', () => {
  it('computes agent/editor data rows from the services', async () => {
    UserService.findAgents.mockResolvedValue([agent]);
    UserService.findEditors.mockResolvedValue([]);
    StudentService.getStudentsWithApplications.mockResolvedValue([
      { applications: [{ admission: 'O' }] },
      { applications: [{ admission: '-' }] }
    ]);
    TeamService.getFileTypeCounts.mockResolvedValue({
      counts1: [
        { _id: 'RL_1', count: 2 },
        { _id: 'Essay', count: 3 }
      ],
      counts2: [
        { _id: 'Recommendation_Letter_X', count: 1 },
        { _id: 'Others', count: 1 },
        { _id: 'CV', count: 4 }
      ]
    });
    TeamService.getStudentsCreationData.mockResolvedValue([]);
    TeamService.getEditorTaskRows.mockResolvedValue([]);
    const res = mockRes();

    await getStatisticsOverview(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.agents_data).toHaveLength(1);
    expect(body.agents_data[0].student_num_with_offer).toBe(1);
    // RL_1 (counts1, 2) + Recommendation_Letter_X (counts2, 1) accumulate
    expect(body.documents.RL.count).toBe(3);
    expect(body.documents.CV.count).toBe(4);
  });

  it('serves the cached value on a second call (cache hit)', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    TeamService.getFileTypeCounts.mockResolvedValue({
      counts1: [],
      counts2: []
    });
    TeamService.getStudentsCreationData.mockResolvedValue([]);
    TeamService.getEditorTaskRows.mockResolvedValue([]);

    await getStatisticsOverview(mockReq(), mockRes(), jest.fn());
    const res = mockRes();
    await getStatisticsOverview(mockReq(), res, jest.fn());

    // Second call should not recompute (findAgents called only once total).
    expect(UserService.findAgents).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getStatisticsAgents (with agents)', () => {
  it('merges admission / no-admission distributions per agent', async () => {
    UserService.findAgents.mockResolvedValue([agent]);
    TeamService.getAgentStudentDistData.mockResolvedValue({
      admission: [
        { expected_application_date: '2026-01', count: 2 },
        { count: 1 }
      ],
      noAdmission: [{ expected_application_date: '2026-02', count: 4 }]
    });
    const res = mockRes();

    await getStatisticsAgents(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.agentStudentDistribution).toHaveLength(1);
    expect(body.agentStudentDistribution[0].admission['2026-01']).toBe(2);
    expect(body.agentStudentDistribution[0].admission.TBD).toBe(1);
  });

  it('buckets no-admission rows without a date under TBD', async () => {
    UserService.findAgents.mockResolvedValue([agent]);
    TeamService.getAgentStudentDistData.mockResolvedValue({
      admission: [],
      noAdmission: [{ count: 7 }]
    });
    const res = mockRes();

    await getStatisticsAgents(mockReq(), res, jest.fn());

    const body = res.send.mock.calls[0][0];
    expect(body.agentStudentDistribution[0].noAdmission.TBD).toBe(7);
  });
});

describe('statistics cache hits', () => {
  it('getStatisticsKPI serves the cached value on a second call', async () => {
    TeamService.getKpiFinishedDocs.mockResolvedValue([{ count: 1 }]);
    await getStatisticsKPI(mockReq(), mockRes(), jest.fn());
    const res = mockRes();
    await getStatisticsKPI(mockReq(), res, jest.fn());
    expect(TeamService.getKpiFinishedDocs).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getStatisticsAgents serves the cached value on a second call', async () => {
    UserService.findAgents.mockResolvedValue([]);
    await getStatisticsAgents(mockReq(), mockRes(), jest.fn());
    const res = mockRes();
    await getStatisticsAgents(mockReq(), res, jest.fn());
    expect(UserService.findAgents).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getStatisticsResponseTime serves the cached value on a second call', async () => {
    UserService.findAgents.mockResolvedValue([]);
    UserService.findEditors.mockResolvedValue([]);
    TeamService.getStudentAvgResponseTime.mockResolvedValue([]);
    await getStatisticsResponseTime(mockReq(), mockRes(), jest.fn());
    const res = mockRes();
    await getStatisticsResponseTime(mockReq(), res, jest.fn());
    expect(UserService.findAgents).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getStatisticsResponseTime (with staff)', () => {
  it('builds agent/editor data rows alongside the avg response time', async () => {
    UserService.findAgents.mockResolvedValue([agent]);
    UserService.findEditors.mockResolvedValue([
      { _id: 'ed-1', firstname: 'Ed', lastname: 'It' }
    ]);
    StudentService.getStudentsWithApplications.mockResolvedValue([
      { applications: [{ admission: 'O' }] }
    ]);
    StudentService.countStudents.mockResolvedValue(4);
    TeamService.getStudentAvgResponseTime.mockResolvedValue([{ avg: 3 }]);
    const res = mockRes();

    await getStatisticsResponseTime(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.agents_data).toHaveLength(1);
    expect(body.editors_data).toHaveLength(1);
    expect(body.editors_data[0].student_num).toBe(4);
    expect(body.studentAvgResponseTime).toEqual([{ avg: 3 }]);
  });
});

describe('getResponseIntervalByStudent (no threads / no intervals)', () => {
  it('drops applications that have no doc_modification_thread', async () => {
    StudentService.getStudentApplicationsForIntervals.mockResolvedValue({
      applications: [
        {
          programId: { _id: 'p1', school: 'X' },
          doc_modification_thread: [{ doc_thread_id: 'th-unmatched' }]
        }
      ]
    });
    // no intervals match the thread -> intervalsByThreads stays empty -> dropped
    TeamService.getIntervals.mockResolvedValue([]);
    const res = mockRes();

    await getResponseIntervalByStudent(
      mockReq({ params: { studentId: 'stud-1' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.data.applications).toEqual([]);
  });
});
