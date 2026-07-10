// Integration test for the team dashboard routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/teams ->
//   real TeamService / PermissionService / StudentService / InterviewService /
//   DocumentThreadService / UserService -> MOCKED DAOs.
//
// These assert the controllers/services pass the right arguments to the DAOs and
// shape the HTTP response from the DAOs' (mocked) return. The aggregation
// construction itself is covered by the DAO unit tests. Fully deterministic — no
// engine flake.

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);

// The data boundary: mock the DAOs the team dashboard services delegate to.
jest.mock('../../dao/team.dao');
jest.mock('../../dao/permission.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/interview.dao');
jest.mock('../../dao/documentthread.dao');
jest.mock('../../dao/user.dao');

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import TeamDAOModule from '../../dao/team.dao';
import PermissionDAOModule from '../../dao/permission.dao';
import StudentDAOModule from '../../dao/student.dao';
import InterviewDAOModule from '../../dao/interview.dao';
import DocumentthreadDAOModule from '../../dao/documentthread.dao';
import UserDAOModule from '../../dao/user.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { agent } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const TeamDAO = TeamDAOModule as unknown as MockedDAO;
const PermissionDAO = PermissionDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const InterviewDAO = InterviewDAOModule as unknown as MockedDAO;
const DocumentthreadDAO = DocumentthreadDAOModule as unknown as MockedDAO;
const UserDAO = UserDAOModule as unknown as MockedDAO;

const api = request(app);

beforeEach(() => {
  jest.clearAllMocks();

  asMock(protect).mockImplementation(
    (req: Request, res: Response, next: NextFunction) => {
      req.user = agent;
      next();
    }
  );

  // Sensible defaults; individual tests override as needed.
  TeamDAO.getTeamMembers.mockResolvedValue([]);
  PermissionDAO.getPermissionByUserId.mockResolvedValue(null);
  StudentDAO.fetchStudents.mockResolvedValue([]);
  StudentDAO.fetchSimpleStudents.mockResolvedValue([]);
  InterviewDAO.getInterviews.mockResolvedValue([]);
  DocumentthreadDAO.findAllStudentsThreadsPopulated.mockResolvedValue([]);
  UserDAO.findAgentById.mockResolvedValue(null);
});

describe('GET /api/teams/ (full stack)', () => {
  it('returns the team members the DAO provides as an array', async () => {
    const members = [
      { _id: agent._id, firstname: agent.firstname, lastname: agent.lastname }
    ];
    TeamDAO.getTeamMembers.mockResolvedValue(members);

    const resp = await api.get('/api/teams/').set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(TeamDAO.getTeamMembers).toHaveBeenCalledTimes(1);
    expect(resp.body.data[0]._id.toString()).toBe(agent._id.toString());
  });
});

describe('GET /api/teams/is-manager (full stack)', () => {
  it('reflects the canAssignAgents/canAssignEditors permission from the DAO', async () => {
    PermissionDAO.getPermissionByUserId.mockResolvedValue({
      canAssignAgents: true,
      canAssignEditors: false
    });

    const resp = await api
      .get('/api/teams/is-manager')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.isManager).toBe(true);
    expect(PermissionDAO.getPermissionByUserId).toHaveBeenCalledWith(agent._id);
  });

  it('returns a data object when no permission doc exists', async () => {
    PermissionDAO.getPermissionByUserId.mockResolvedValue(null);

    const resp = await api
      .get('/api/teams/is-manager')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('object');
  });
});

describe('GET /api/teams/tasks-overview (full stack)', () => {
  it('returns numeric counts derived from each DAO bucket', async () => {
    StudentDAO.fetchStudents
      .mockResolvedValueOnce([{ _id: '1' }, { _id: '2' }]) // noAgentsStudents
      .mockResolvedValueOnce([{ _id: '3' }]); // noEditorsStudents
    InterviewDAO.getInterviews.mockResolvedValue([{ _id: 'i1' }]);
    StudentDAO.fetchSimpleStudents.mockResolvedValue([{ _id: 's1' }]);
    DocumentthreadDAO.findAllStudentsThreadsPopulated.mockResolvedValue([]);

    const resp = await api
      .get('/api/teams/tasks-overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.noAgentsStudents).toBe(2);
    expect(resp.body.data.noEditorsStudents).toBe(1);
    expect(typeof resp.body.data.noTrainerInInterviewsStudents).toBe('number');
    expect(typeof resp.body.data.noEssayWritersEssays).toBe('number');
  });
});

describe('GET /api/agents/profile/:agent_id (full stack)', () => {
  it('returns the agent profile the DAO looks up by id', async () => {
    UserDAO.findAgentById.mockResolvedValue({
      _id: agent._id,
      firstname: agent.firstname,
      lastname: agent.lastname,
      email: agent.email
    });

    const resp = await api
      .get(`/api/agents/profile/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(agent._id.toString());
    expect(UserDAO.findAgentById).toHaveBeenCalledWith(
      agent._id.toString(),
      'firstname lastname email selfIntroduction officehours timezone'
    );
  });
});
