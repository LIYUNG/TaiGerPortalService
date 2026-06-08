// Controller UNIT test for controllers/applications.
//
// applications is a "tangled" controller: a handler can fan out to several
// services (Application/Student/User/Program/DocumentThread) and an email
// side-effect. We call each handler DIRECTLY as a (req, res, next) function with
// all of those mocked, and assert ONLY the controller's own work: the
// filter/args it forwards, the status + body it writes, and its branching. No
// route, no middleware, no DB. The heavy document-mutating create flow
// (createApplicationV2) and the real aggregation are covered end-to-end by
// __tests__/integration/applications.test.js and the service/dao suites.

jest.mock('../../services/applications');
jest.mock('../../services/users');
jest.mock('../../services/students');
jest.mock('../../services/programs');
jest.mock('../../services/documentthreads');
jest.mock('../../services/email');

const ApplicationService = require('../../services/applications');
const StudentService = require('../../services/students');
const {
  getApplications,
  deleteApplication,
  getActiveStudentsApplicationsPaginated,
  getApplicationsDeadlineDistribution,
  getApplicationProgramsUpdateStatus,
  getMyStudentsApplicationsStats,
  getStudentApplications,
  updateStudentApplications,
  updateApplication,
  refreshApplication
} = require('../../controllers/applications');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { agent, admin, student } = require('../mock/user');

const studentId = student._id.toString();
const agentId = agent._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getApplications', () => {
  it('200: forwards the built filter + select/populate and returns the applications', async () => {
    const applications = [{ _id: 'a1' }];
    ApplicationService.getApplications.mockResolvedValue(applications);
    const req = mockReq({ query: { decided: 'O', year: '2025' } });
    const res = mockRes();

    await getApplications(req, res, jest.fn());

    expect(ApplicationService.getApplications).toHaveBeenCalledWith(
      { decided: 'O', application_year: '2025' },
      expect.arrayContaining(['programId', 'studentId', 'application_year']),
      false
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: applications
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    ApplicationService.getApplications.mockRejectedValue(err);
    const next = jest.fn();

    await getApplications(mockReq({ query: {} }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getActiveStudentsApplicationsPaginated', () => {
  it('200: resolves student ids then forwards them + the query to the service', async () => {
    StudentService.getStudents.mockResolvedValue([
      { _id: studentId },
      { _id: '012345678901234567891234' }
    ]);
    const result = { applications: [], total: 0 };
    ApplicationService.getActiveStudentsApplicationsPaginated.mockResolvedValue(
      result
    );
    const req = mockReq({ query: { page: '1' } });
    const res = mockRes();

    await getActiveStudentsApplicationsPaginated(req, res, jest.fn());

    expect(
      ApplicationService.getActiveStudentsApplicationsPaginated
    ).toHaveBeenCalledWith({
      studentIds: [studentId, '012345678901234567891234'],
      query: { page: '1' }
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: result });
  });

  it('scopes to a supervising user when userId is present', async () => {
    StudentService.getStudents.mockResolvedValue([]);
    ApplicationService.getActiveStudentsApplicationsPaginated.mockResolvedValue(
      { applications: [], total: 0 }
    );
    const req = mockReq({ query: { userId: agentId } });

    await getActiveStudentsApplicationsPaginated(req, mockRes(), jest.fn());

    // withArchiv(false) sets $or, so the supervision condition is merged via $and.
    const passedFilter = StudentService.getStudents.mock.calls[0][0].filter;
    expect(passedFilter.$and).toEqual([
      { $or: [{ archiv: { $exists: false } }, { archiv: false }] },
      { $or: [{ agents: agentId }, { editors: agentId }] }
    ]);
    expect(passedFilter.$or).toBeUndefined();
  });
});

describe('getApplicationsDeadlineDistribution', () => {
  it('200: forwards resolved student ids and returns the distribution', async () => {
    StudentService.getStudents.mockResolvedValue([{ _id: studentId }]);
    const data = [{ name: '2025/01/15', active: 1, potentials: 0 }];
    ApplicationService.getActiveStudentsApplicationsDeadlineDistribution.mockResolvedValue(
      data
    );
    const res = mockRes();

    await getApplicationsDeadlineDistribution(
      mockReq({ query: {} }),
      res,
      jest.fn()
    );

    expect(
      ApplicationService.getActiveStudentsApplicationsDeadlineDistribution
    ).toHaveBeenCalledWith({ studentIds: [studentId] });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data });
  });
});

describe('getApplicationProgramsUpdateStatus', () => {
  it('200: forwards student ids + decided flag and returns the programs', async () => {
    StudentService.getStudents.mockResolvedValue([{ _id: studentId }]);
    const data = [{ _id: 'p1', program_name: 'Alpha' }];
    ApplicationService.getApplicationProgramsUpdateStatus.mockResolvedValue(
      data
    );
    const res = mockRes();

    await getApplicationProgramsUpdateStatus(
      mockReq({ query: { decided: 'O' } }),
      res,
      jest.fn()
    );

    expect(
      ApplicationService.getApplicationProgramsUpdateStatus
    ).toHaveBeenCalledWith({ studentIds: [studentId], decided: 'O' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data });
  });
});

describe('getMyStudentsApplicationsStats', () => {
  it('200: returns the user + stats with totalStudents derived from the student count', async () => {
    StudentService.getStudents.mockResolvedValue([
      { _id: studentId },
      { _id: '012345678901234567891234' }
    ]);
    ApplicationService.getApplicationStatusStats.mockResolvedValue({
      totalApplications: 3,
      decidedYesApplications: 3
    });
    const UserService = require('../../services/users');
    UserService.getUserById.mockResolvedValue({ _id: agentId });
    const res = mockRes();

    await getMyStudentsApplicationsStats(
      mockReq({ params: { userId: agentId } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.getApplicationStatusStats).toHaveBeenCalledWith({
      studentIds: [studentId, '012345678901234567891234']
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.user).toEqual({ _id: agentId });
    expect(body.data.stats).toMatchObject({
      totalStudents: 2,
      totalApplications: 3,
      decidedYesApplications: 3
    });
  });
});

describe('getStudentApplications', () => {
  it('200: attaches the applications onto the student (non-student user, no notification touch)', async () => {
    const studentDoc = { _id: studentId, firstname: 'Stu', attributes: ['x'] };
    StudentService.getStudentById.mockResolvedValue(studentDoc);
    const applications = [{ _id: 'a1' }];
    ApplicationService.getApplicationsByStudentId.mockResolvedValue(
      applications
    );
    const res = mockRes();

    await getStudentApplications(
      mockReq({ user: agent, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentById).toHaveBeenCalledWith(studentId);
    expect(ApplicationService.getApplicationsByStudentId).toHaveBeenCalledWith(
      studentId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.applications).toBe(applications);
    // Non-student callers keep the attributes field.
    expect(body.data.attributes).toBeDefined();
  });
});

describe('updateStudentApplications', () => {
  it('404: throws (forwarded to next) when the student does not exist', async () => {
    StudentService.getStudentById.mockResolvedValue(null);
    const next = jest.fn();

    await updateStudentApplications(
      mockReq({
        user: agent,
        params: { studentId },
        body: { applications: [], applying_program_count: 3 }
      }),
      mockRes(),
      next
    );

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
  });

  it('201: bulk-updates applications and returns the refreshed student (agent does not touch applying_program_count)', async () => {
    StudentService.getStudentById
      .mockResolvedValueOnce({ _id: studentId }) // pre-update lookup
      .mockResolvedValueOnce({ _id: studentId, firstname: 'Stu' }); // post-update
    ApplicationService.updateApplicationsBulk.mockResolvedValue({
      modifiedCount: 1
    });
    const newApplications = [{ _id: 'a1', decided: 'O' }];
    ApplicationService.getApplicationsByStudentId.mockResolvedValue(
      newApplications
    );
    const res = mockRes();

    await updateStudentApplications(
      mockReq({
        user: agent,
        params: { studentId },
        body: {
          applications: [
            {
              _id: 'a1',
              decided: 'O',
              closed: '-',
              admission: '-',
              finalEnrolment: false
            }
          ],
          applying_program_count: 5
        }
      }),
      res,
      jest.fn()
    );

    expect(ApplicationService.updateApplicationsBulk).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: 'a1' },
          update: {
            decided: 'O',
            closed: '-',
            admission: '-',
            finalEnrolment: false
          }
        }
      }
    ]);
    // Agent (not Admin) must NOT update applying_program_count.
    expect(StudentService.updateStudentById).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.applications).toBe(newApplications);
  });

  it('201: Admin also updates applying_program_count', async () => {
    StudentService.getStudentById
      .mockResolvedValueOnce({ _id: studentId })
      .mockResolvedValueOnce({ _id: studentId });
    ApplicationService.updateApplicationsBulk.mockResolvedValue({});
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([]);
    const res = mockRes();

    await updateStudentApplications(
      mockReq({
        user: admin,
        params: { studentId },
        body: { applications: [], applying_program_count: '7' }
      }),
      res,
      jest.fn()
    );

    expect(StudentService.updateStudentById).toHaveBeenCalledWith(studentId, {
      applying_program_count: 7
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateApplication', () => {
  it('200: forwards the application id filter + payload and returns the updated application', async () => {
    const application = { _id: 'app1', decided: 'O' };
    ApplicationService.updateApplication.mockResolvedValue(application);
    const res = mockRes();

    await updateApplication(
      mockReq({ params: { application_id: 'app1' }, body: { decided: 'O' } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: 'app1' },
      { decided: 'O' }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: application });
  });
});

describe('deleteApplication', () => {
  it('200: forwards the application id and reports success', async () => {
    ApplicationService.deleteApplication.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteApplication(
      mockReq({ params: { application_id: 'app1' } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.deleteApplication).toHaveBeenCalledWith('app1');
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('thread not empty');
    ApplicationService.deleteApplication.mockRejectedValue(err);
    const next = jest.fn();

    await deleteApplication(
      mockReq({ params: { application_id: 'app1' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('refreshApplication', () => {
  it('200: unlocks the application and returns it via res.json', async () => {
    const updated = { _id: 'app1', isLocked: false };
    ApplicationService.unlockApplication.mockResolvedValue(updated);
    const res = mockRes();

    await refreshApplication(
      mockReq({ params: { applicationId: 'app1' } }),
      res,
      jest.fn()
    );

    expect(ApplicationService.unlockApplication).toHaveBeenCalledWith('app1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('404: responds not found (via res.json) when the application is missing', async () => {
    ApplicationService.unlockApplication.mockResolvedValue(null);
    const res = mockRes();

    await refreshApplication(
      mockReq({ params: { applicationId: 'missing' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
