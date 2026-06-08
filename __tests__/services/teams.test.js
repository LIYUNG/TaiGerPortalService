// TeamService methods are thin pass-throughs to TeamDAO (analytics queries for
// the internal team dashboards). This is a UNIT test: the DAO is mocked so no
// database is touched. Each test asserts the right DAO method is called once
// with the exact args and that the service returns the DAO's result unchanged.
jest.mock('../../dao/team.dao');

const TeamDAO = require('../../dao/team.dao');
const TeamService = require('../../services/teams');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TeamService (mocked DAO) — no-arg delegators', () => {
  const noArgMethods = [
    'getActivePrograms',
    'getTeamMembers',
    'getGeneralTasks',
    'getDecidedApplicationsTasks',
    'getFileTypeCounts',
    'getEditorTaskRows',
    'getStudentsCreationData',
    'getStudentAvgResponseTime',
    'getKpiFinishedDocs'
  ];

  noArgMethods.forEach((method) => {
    it(`${method} delegates to DAO.${method} with no args`, () => {
      const daoResult = { method };
      TeamDAO[method].mockReturnValue(daoResult);

      const result = TeamService[method]();

      expect(TeamDAO[method]).toHaveBeenCalledTimes(1);
      expect(TeamDAO[method]).toHaveBeenCalledWith();
      expect(result).toBe(daoResult);
    });
  });
});

describe('TeamService (mocked DAO) — arg delegators', () => {
  it('getAgentStudentDistData delegates to DAO with agentId', () => {
    const agentId = 'agent_1';
    const daoResult = [{ agent: 'agent_1', count: 5 }];
    TeamDAO.getAgentStudentDistData.mockReturnValue(daoResult);

    const result = TeamService.getAgentStudentDistData(agentId);

    expect(TeamDAO.getAgentStudentDistData).toHaveBeenCalledTimes(1);
    expect(TeamDAO.getAgentStudentDistData).toHaveBeenCalledWith(agentId);
    expect(result).toBe(daoResult);
  });

  it('getResponseTimesByStudent delegates to DAO with studentId', () => {
    const studentId = 's1';
    const daoResult = [{ student: 's1', avg: 3 }];
    TeamDAO.getResponseTimesByStudent.mockReturnValue(daoResult);

    const result = TeamService.getResponseTimesByStudent(studentId);

    expect(TeamDAO.getResponseTimesByStudent).toHaveBeenCalledTimes(1);
    expect(TeamDAO.getResponseTimesByStudent).toHaveBeenCalledWith(studentId);
    expect(result).toBe(daoResult);
  });

  it('getIntervals delegates to DAO with filter', () => {
    const filter = { from: '2026-01-01', to: '2026-02-01' };
    const daoResult = [{ interval: 1 }];
    TeamDAO.getIntervals.mockReturnValue(daoResult);

    const result = TeamService.getIntervals(filter);

    expect(TeamDAO.getIntervals).toHaveBeenCalledTimes(1);
    expect(TeamDAO.getIntervals).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });
});
