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

import ApplicationService from '../../services/applications';
import StudentService from '../../services/students';
import ProgramService from '../../services/programs';
import DocumentThreadService from '../../services/documentthreads';
import * as EmailService from '../../services/email';
import {
  getApplications,
  deleteApplication,
  getStudentsApplicationsPaginated,
  getApplicationsDeadlineDistribution,
  getApplicationProgramsUpdateStatus,
  getMyStudentsApplicationsStats,
  getStudentApplications,
  updateStudentApplications,
  updateApplication,
  createApplicationV2,
  refreshApplication
} from '../../controllers/applications';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { agent, admin, student } from '../mock/user';

// 24-hex ObjectId strings (createApplicationV2 wraps program ids in
// new mongoose.Types.ObjectId(...), which requires a valid hex string).
const programIdA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const programIdB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

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

describe('getStudentsApplicationsPaginated', () => {
  it('200: resolves student ids then forwards them + the query to the service', async () => {
    StudentService.getStudents.mockResolvedValue([
      { _id: studentId },
      { _id: '012345678901234567891234' }
    ]);
    const result = { applications: [], total: 0 };
    ApplicationService.getStudentsApplicationsPaginated.mockResolvedValue(
      result
    );
    const req = mockReq({ query: { page: '1' } });
    const res = mockRes();

    await getStudentsApplicationsPaginated(req, res, jest.fn());

    expect(
      ApplicationService.getStudentsApplicationsPaginated
    ).toHaveBeenCalledWith({
      studentIds: [studentId, '012345678901234567891234'],
      query: { page: '1' }
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: result });
  });

  it('scopes to a supervising user + active students when archiv=false', async () => {
    StudentService.getStudents.mockResolvedValue([]);
    ApplicationService.getStudentsApplicationsPaginated.mockResolvedValue({
      applications: [],
      total: 0
    });
    const req = mockReq({ query: { userId: agentId, archiv: 'false' } });

    await getStudentsApplicationsPaginated(req, mockRes(), jest.fn());

    // withArchiv('false') sets $or, so the supervision condition is merged via $and.
    const passedFilter = StudentService.getStudents.mock.calls[0][0].filter;
    expect(passedFilter.$and).toEqual([
      { $or: [{ archiv: { $exists: false } }, { archiv: false }] },
      { $or: [{ agents: agentId }, { editors: agentId }] }
    ]);
    expect(passedFilter.$or).toBeUndefined();
  });

  it('spans all students (no archiv condition) when archiv is omitted', async () => {
    StudentService.getStudents.mockResolvedValue([]);
    ApplicationService.getStudentsApplicationsPaginated.mockResolvedValue({
      applications: [],
      total: 0
    });
    const req = mockReq({ query: { userId: agentId } });

    await getStudentsApplicationsPaginated(req, mockRes(), jest.fn());

    // No archiv filter, so the supervision $or is set directly (no $and merge).
    const passedFilter = StudentService.getStudents.mock.calls[0][0].filter;
    expect(passedFilter.$or).toEqual([
      { agents: agentId },
      { editors: agentId }
    ]);
    expect(passedFilter.$and).toBeUndefined();
    expect(passedFilter.archiv).toBeUndefined();
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

  it('200: student caller clears the new-programs notification and strips attributes', async () => {
    const studentUser = {
      ...student,
      role: 'Student',
      notification: {}
    };
    StudentService.updateStudentById.mockResolvedValue({});
    const studentDoc = { _id: studentId, firstname: 'Stu', attributes: ['x'] };
    StudentService.getStudentById.mockResolvedValue(studentDoc);
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([
      { _id: 'a1' }
    ]);
    const res = mockRes();

    await getStudentApplications(
      mockReq({ user: studentUser, params: { studentId } }),
      res,
      jest.fn()
    );

    // Notification cleanup happens for student callers.
    expect(StudentService.updateStudentById).toHaveBeenCalledWith(
      studentUser._id.toString(),
      { notification: { isRead_new_programs_assigned: true } }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    // Student callers must not see attributes.
    expect(body.data.attributes).toBeUndefined();
  });
});

describe('createApplicationV2', () => {
  // A fresh application doc whose embedded doc_modification_thread subdoc array
  // supports .create()/.push() and which is awaitably saveable.
  const makeApplicationDoc = (id = 'app-new') => {
    const arr = [];
    arr.create = (obj) => ({ ...obj });
    return {
      _id: id,
      doc_modification_thread: arr,
      save: jest.fn().mockResolvedValue()
    };
  };

  const makeStudentDoc = (overrides = {}) => ({
    _id: studentId,
    firstname: 'Stu',
    lastname: 'Dent',
    email: 's@example.com',
    archiv: false,
    generaldocs_threads: [],
    application_preference: { expected_application_date: '2025 WS' },
    notification: {},
    save: jest.fn().mockResolvedValue(),
    ...overrides
  });

  it('400: rejects when more than 20 programs are assigned (no service calls)', async () => {
    const next = jest.fn();
    const program_id_set = Array.from({ length: 21 }, () => programIdA);

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(StudentService.getStudentDocById).not.toHaveBeenCalled();
  });

  it('400: rejects when some program ids are out-of-date (findPrograms returns fewer)', async () => {
    StudentService.getStudentDocById.mockResolvedValue(makeStudentDoc());
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    // Two requested, only one valid program returned => out-of-date.
    ProgramService.findPrograms.mockResolvedValue([
      { _id: { toString: () => programIdA } }
    ]);
    const next = jest.fn();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA, programIdB] }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(ApplicationService.createApplicationDoc).not.toHaveBeenCalled();
  });

  it('400: rejects when the resulting application count would exceed the max', async () => {
    StudentService.getStudentDocById.mockResolvedValue(makeStudentDoc());
    // 20 existing applications + 1 new > 20 max.
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        programId: { _id: { toString: () => `existing-${i}` } },
        application_year: '2025 WS'
      }))
    );
    ProgramService.findPrograms.mockResolvedValue([
      { _id: { toString: () => programIdA }, country: 'de' }
    ]);
    const next = jest.fn();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(ApplicationService.createApplicationDoc).not.toHaveBeenCalled();
  });

  it('201: creates a new application (approval country => unlocked, no RL/supplement), then emails the active student', async () => {
    const studentDoc = makeStudentDoc();
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    ProgramService.findPrograms.mockResolvedValue([
      // 'de' is an approval country => isLocked false; no rl_required key, no
      // PROGRAM_SPECIFIC_FILETYPE flags => neither thread branch runs.
      { _id: { toString: () => programIdA }, country: 'DE' }
    ]);
    ApplicationService.createApplicationDoc.mockResolvedValue(
      makeApplicationDoc()
    );
    const fullApps = [{ _id: 'app-new' }];
    ApplicationService.findByStudentIdPopulatedFull.mockResolvedValue(fullApps);
    EmailService.createApplicationToStudentEmail.mockResolvedValue();
    const res = mockRes();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      res,
      jest.fn()
    );

    expect(ApplicationService.createApplicationDoc).toHaveBeenCalledWith(
      expect.objectContaining({ studentId, isLocked: false })
    );
    expect(studentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: fullApps });
    expect(EmailService.createApplicationToStudentEmail).toHaveBeenCalledTimes(
      1
    );
  });

  it('201: non-approval country locks the application and creates general RL + supplementary threads', async () => {
    const studentDoc = makeStudentDoc();
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    ProgramService.findPrograms.mockResolvedValue([
      {
        _id: { toString: () => programIdA },
        country: 'us', // not in approval list => isLocked true
        rl_required: '2', // general RL (is_rl_specific falsy)
        is_rl_specific: false,
        ml_required: 'yes' // triggers a supplementary ML thread
      }
    ]);
    ApplicationService.createApplicationDoc.mockResolvedValue(
      makeApplicationDoc()
    );
    // No general RL threads exist yet => create 2.
    DocumentThreadService.countThreads.mockResolvedValue(0);
    // _id must be a 24-hex string: the general-RL branch wraps it in
    // new mongoose.Types.ObjectId(newThread._id).
    DocumentThreadService.newThread.mockReturnValue({
      _id: 'cccccccccccccccccccccccc',
      save: jest.fn().mockResolvedValue()
    });
    ApplicationService.findByStudentIdPopulatedFull.mockResolvedValue([]);
    EmailService.createApplicationToStudentEmail.mockResolvedValue();
    const res = mockRes();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      res,
      jest.fn()
    );

    expect(ApplicationService.createApplicationDoc).toHaveBeenCalledWith(
      expect.objectContaining({ isLocked: true })
    );
    // 2 general RL threads created.
    expect(DocumentThreadService.countThreads).toHaveBeenCalledTimes(1);
    // newThread called for the 2 RL threads + 1 supplementary (ML) thread.
    expect(DocumentThreadService.newThread).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('201: specific RL program creates application-scoped RL threads', async () => {
    const studentDoc = makeStudentDoc();
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    ProgramService.findPrograms.mockResolvedValue([
      {
        _id: { toString: () => programIdA },
        country: 'us',
        rl_required: '1',
        is_rl_specific: true
      }
    ]);
    ApplicationService.createApplicationDoc.mockResolvedValue(
      makeApplicationDoc()
    );
    DocumentThreadService.newThread.mockReturnValue({
      _id: 'thread-rl',
      save: jest.fn().mockResolvedValue()
    });
    ApplicationService.findByStudentIdPopulatedFull.mockResolvedValue([]);
    EmailService.createApplicationToStudentEmail.mockResolvedValue();
    const res = mockRes();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      res,
      jest.fn()
    );

    // Specific RL path does not count general threads.
    expect(DocumentThreadService.countThreads).not.toHaveBeenCalled();
    expect(DocumentThreadService.newThread).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('does not email when the student is archived (still responds 201)', async () => {
    const studentDoc = makeStudentDoc({ archiv: true });
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    ProgramService.findPrograms.mockResolvedValue([
      { _id: { toString: () => programIdA }, country: 'de' }
    ]);
    ApplicationService.createApplicationDoc.mockResolvedValue(
      makeApplicationDoc()
    );
    ApplicationService.findByStudentIdPopulatedFull.mockResolvedValue([]);
    const res = mockRes();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(EmailService.createApplicationToStudentEmail).not.toHaveBeenCalled();
  });

  it('wraps an RL-thread creation failure as a 500 (existing general threads exercised)', async () => {
    const studentDoc = makeStudentDoc({
      // Non-empty generaldocs_threads => the .map(thread => thread.doc_thread_id)
      // callback runs.
      generaldocs_threads: [{ doc_thread_id: 'existing-thread' }]
    });
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    ProgramService.findPrograms.mockResolvedValue([
      {
        _id: { toString: () => programIdA },
        country: 'us',
        rl_required: '1',
        is_rl_specific: false
      }
    ]);
    ApplicationService.createApplicationDoc.mockResolvedValue(
      makeApplicationDoc()
    );
    DocumentThreadService.countThreads.mockResolvedValue(0);
    // newThread.save rejects => inner RL catch throws 500 => outer catch
    // re-wraps as 'Failed to create application'.
    DocumentThreadService.newThread.mockReturnValue({
      _id: 'cccccccccccccccccccccccc',
      save: jest.fn().mockRejectedValue(new Error('save boom'))
    });
    const next = jest.fn();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });

  it('wraps a supplementary-form thread failure as a 500', async () => {
    const studentDoc = makeStudentDoc();
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    ProgramService.findPrograms.mockResolvedValue([
      // No rl_required => skip RL block; ml_required 'yes' => supplementary block.
      { _id: { toString: () => programIdA }, country: 'de', ml_required: 'yes' }
    ]);
    ApplicationService.createApplicationDoc.mockResolvedValue(
      makeApplicationDoc()
    );
    DocumentThreadService.newThread.mockReturnValue({
      _id: 'cccccccccccccccccccccccc',
      save: jest.fn().mockRejectedValue(new Error('supp boom'))
    });
    const next = jest.fn();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });

  it('skips programs the student already applied to (same year) => no createApplicationDoc', async () => {
    const studentDoc = makeStudentDoc();
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    // Existing application for programIdA in the same expected year.
    ApplicationService.findByStudentIdPopulatedBasic.mockResolvedValue([
      {
        programId: { _id: { toString: () => programIdA } },
        application_year: '2025 WS'
      }
    ]);
    ProgramService.findPrograms.mockResolvedValue([
      { _id: { toString: () => programIdA }, country: 'de' }
    ]);
    ApplicationService.findByStudentIdPopulatedFull.mockResolvedValue([]);
    EmailService.createApplicationToStudentEmail.mockResolvedValue();
    const res = mockRes();

    await createApplicationV2(
      mockReq({
        user: agent,
        params: { studentId },
        body: { program_id_set: [programIdA] }
      }),
      res,
      jest.fn()
    );

    expect(ApplicationService.createApplicationDoc).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
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
