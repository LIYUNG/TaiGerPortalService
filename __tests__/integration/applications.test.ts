// Integration test for the applications routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/applications
//   -> real Application/Student/User/Program/DocumentThread services -> MOCKED
//   DAOs.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The aggregation /
// deadline-derivation logic itself is covered by the DAO unit tests
// (__tests__/dao/application.dao.test.js). Fully deterministic — no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { protect } from '../../middlewares/auth';
import { InnerTaigerMultitenantFilter } from '../../middlewares/InnerTaigerMultitenantFilter';
import { permission_canAccessStudentDatabase_filter } from '../../middlewares/permission-filter';
import { ErrorResponse } from '../../common/errors';
import { TENANT_ID } from '../fixtures/constants';
import { agent, student, student2 } from '../mock/user';
import { program1, programs } from '../mock/programs';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The standard passthrough middleware mocks live in one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);

// createApplicationV2 notifies the student by email after the upsert
// (fire-and-forget); stub the sender so no SMTP connection is opened.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  createApplicationToStudentEmail: jest.fn()
}));

// The data boundary: mock the DAOs the controller's services delegate to.
jest.mock('../../dao/application.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/program.dao');
jest.mock('../../dao/user.dao');
jest.mock('../../dao/documentthread.dao');

import ApplicationDAOModule from '../../dao/application.dao';
import StudentDAOModule from '../../dao/student.dao';
import ProgramDAOModule from '../../dao/program.dao';
import UserDAOModule from '../../dao/user.dao';
import DocumentthreadDAOModule from '../../dao/documentthread.dao';
import mongoose from 'mongoose';
import { app } from '../../app';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const ProgramDAO = ProgramDAOModule as unknown as MockedDAO;
const UserDAO = UserDAOModule as unknown as MockedDAO;
const DocumentthreadDAO = DocumentthreadDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = agent;
      next();
    }
  );
  asMock(InnerTaigerMultitenantFilter).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => next()
  );
  asMock(permission_canAccessStudentDatabase_filter).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => next()
  );
});

describe('POST /api/applications/student/:studentId', () => {
  it('creates applications for the new programs and returns 201', async () => {
    const studentId = student._id.toString();
    const programs_arr = programs.map((pro) => pro._id.toString());

    // Live student doc the controller mutates + .save()s.
    const studentDoc = {
      _id: student._id,
      firstname: student.firstname,
      lastname: student.lastname,
      email: 'student@taiger.com',
      archiv: false,
      notification: {},
      generaldocs_threads: [],
      application_preference: { expected_application_date: '2025' },
      save: jest.fn().mockResolvedValue(true)
    };
    StudentDAO.getStudentDocById.mockResolvedValue(studentDoc);
    // No pre-existing applications.
    ApplicationDAO.findByStudentIdPopulatedBasic.mockResolvedValue([]);
    // All requested programs are valid/active.
    ProgramDAO.findPrograms.mockResolvedValue(programs);
    // The faker programs have ml_required: 'yes', so the controller creates an
    // ML supplementary-form thread per application via the documentthread DAO.
    DocumentthreadDAO.newThread.mockImplementation((payload) => ({
      _id: new mongoose.Types.ObjectId(),
      ...payload,
      save: jest.fn().mockResolvedValue(true)
    }));
    // Each new program yields a created application doc. The subdocument array
    // exposes .create()/.push() (the controller appends thread entries to it).
    ApplicationDAO.createApplicationDoc.mockImplementation(async (payload) => {
      // Mimic the Mongoose subdocument array the controller appends thread
      // entries to: a real array that also exposes .create().
      const thread = Object.assign([] as Record<string, unknown>[], {
        create: (entry: Record<string, unknown>) => entry
      });
      return {
        _id: payload.programId,
        ...payload,
        doc_modification_thread: thread,
        save: jest.fn().mockResolvedValue(true)
      };
    });
    const created = programs.map((pro) => ({
      _id: pro._id,
      programId: { _id: pro._id, program_name: pro.program_name },
      studentId: student._id
    }));
    ApplicationDAO.findByStudentIdPopulatedFull.mockResolvedValue(created);

    const resp = await requestWithSupertest
      .post(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ program_id_set: programs_arr });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(programs_arr.length);
    expect(ApplicationDAO.createApplicationDoc).toHaveBeenCalledTimes(
      programs_arr.length
    );
    expect(studentDoc.save).toHaveBeenCalled();
  });
});

describe('GET /api/applications/student/:studentId', () => {
  it('returns the student with their applications attached', async () => {
    const studentId = student2._id.toString();
    StudentDAO.getStudentById.mockResolvedValue({
      _id: student2._id,
      firstname: student2.firstname,
      lastname: student2.lastname
    });
    const applications = [
      { _id: '1', programId: program1._id },
      { _id: '2', programId: program1._id }
    ];
    ApplicationDAO.getApplicationsByStudentId.mockResolvedValue(applications);

    const resp = await requestWithSupertest
      .get(`/api/applications/student/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.applications).toHaveLength(2);
    expect(StudentDAO.getStudentById).toHaveBeenCalledWith(studentId);
    expect(ApplicationDAO.getApplicationsByStudentId).toHaveBeenCalledWith(
      studentId
    );
  });
});

describe('DELETE /api/applications/application/:applicationId', () => {
  it('deletes an application via the DAO', async () => {
    ApplicationDAO.deleteApplication.mockResolvedValue(undefined);

    const del = await requestWithSupertest
      .delete('/api/applications/application/app-123')
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    expect(ApplicationDAO.deleteApplication).toHaveBeenCalledWith('app-123');
  });

  it('surfaces the DAO 409 when a thread still has messages', async () => {
    // deleteApplication() in the DAO throws a 409 when a non-empty thread is
    // found; the controller propagates it.
    ApplicationDAO.deleteApplication.mockRejectedValue(
      new ErrorResponse(409, 'Some ML/RL/Essay discussion threads are existed')
    );

    const del = await requestWithSupertest
      .delete('/api/applications/application/app-123')
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(409);
  });
});

describe('GET /api/applications/applications/paginated', () => {
  const PAGINATED_URL = '/api/applications/applications/paginated';

  it('passes the active student ids through and returns the paginated result', async () => {
    StudentDAO.getStudents.mockResolvedValue([
      { _id: student._id },
      { _id: student2._id }
    ]);
    ApplicationDAO.getStudentsApplicationsPaginated.mockResolvedValue({
      applications: [
        { _id: 'a', programId: { program_name: 'Beta Program' } },
        { _id: 'b', programId: { program_name: 'Gamma Program' } }
      ],
      total: 3,
      page: 1,
      limit: 20
    });

    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?page=1&limit=20&sortBy=deadline&sortOrder=asc`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.total).toBe(3);
    expect(resp.body.data.applications).toHaveLength(2);
    expect(
      ApplicationDAO.getStudentsApplicationsPaginated
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        studentIds: [student._id.toString(), student2._id.toString()]
      })
    );
  });

  it('scopes to a supervising TaiGer user (userId query)', async () => {
    StudentDAO.getStudents.mockResolvedValue([{ _id: student._id }]);
    ApplicationDAO.getStudentsApplicationsPaginated.mockResolvedValue({
      applications: [],
      total: 3,
      page: 1,
      limit: 20
    });

    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?userId=${agent._id}&sortBy=program_name`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data.total).toBe(3);
    // The supervision filter ($or agents/editors === userId) is built into the
    // student query passed to getStudents.
    const studentFilter = StudentDAO.getStudents.mock.calls[0][0].filter;
    expect(JSON.stringify(studentFilter)).toContain(agent._id.toString());
  });
});

describe('GET /api/applications/distribution', () => {
  it('returns the deadline distribution computed by the DAO', async () => {
    StudentDAO.getStudents.mockResolvedValue([{ _id: student._id }]);
    const distribution = [
      { name: '2024/05/01', active: 1, potentials: 0 },
      { name: '2025/01/15', active: 1, potentials: 0 }
    ];
    ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution.mockResolvedValue(
      distribution
    );

    const resp = await requestWithSupertest
      .get('/api/applications/distribution')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data).toEqual(distribution);
  });
});

describe('GET /api/applications/program-update-status', () => {
  it('returns the distinct programs computed by the DAO', async () => {
    StudentDAO.getStudents.mockResolvedValue([{ _id: student._id }]);
    const progList = [
      { program_name: 'Alpha Program' },
      { program_name: 'Beta Program' }
    ];
    ApplicationDAO.getApplicationProgramsUpdateStatus.mockResolvedValue(
      progList
    );

    const resp = await requestWithSupertest
      .get('/api/applications/program-update-status')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(
      resp.body.data.map((p: { program_name: string }) => p.program_name)
    ).toEqual(['Alpha Program', 'Beta Program']);
  });
});

describe('GET /api/applications/taiger-user/:userId/stats', () => {
  it('returns aggregated application stats plus the user record', async () => {
    StudentDAO.getStudents.mockResolvedValue([{ _id: student._id }]);
    ApplicationDAO.getApplicationStatusStats.mockResolvedValue({
      totalApplications: 3,
      decidedYesApplications: 3,
      pendingApplications: 3
    });
    UserDAO.getUserById.mockResolvedValue({
      _id: agent._id,
      firstname: agent.firstname
    });

    const resp = await requestWithSupertest
      .get(`/api/applications/taiger-user/${agent._id}/stats`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data.stats).toMatchObject({
      totalStudents: 1,
      totalApplications: 3,
      decidedYesApplications: 3,
      pendingApplications: 3
    });
    expect(resp.body.data.user._id.toString()).toBe(agent._id.toString());
    expect(UserDAO.getUserById).toHaveBeenCalledWith(agent._id.toString());
  });
});
