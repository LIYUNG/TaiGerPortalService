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

const TeamService = require('../../services/teams');
const StudentService = require('../../services/students');
const UserService = require('../../services/users');
const PermissionService = require('../../services/permissions');
const InterviewService = require('../../services/interviews');
const DocumentThreadService = require('../../services/documentthreads');
const { ten_minutes_cache } = require('../../cache/node-cache');
const {
  getTeamMembers,
  getIsManager,
  getTasksOverview,
  getResponseTimeByStudent,
  getArchivStudents,
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
