// Integration test for the programs routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/programs ->
//   real ProgramService / VCService / ApplicationService /
//   ProgramRequirementService / TicketService ->
//   MOCKED ProgramDAO / VCDAO / ApplicationDAO / ProgramRequirementDAO / TicketDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual
// query/aggregation/pagination construction is covered by the DAO unit tests.
// Fully deterministic — no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});
jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});
jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles: string[]) => passthrough)
  };
});

// The data boundary: mock every DAO the program handlers reach (incl. the VC /
// application / requirement / ticket reads & writes triggered on update/delete).
jest.mock('../../dao/program.dao');
jest.mock('../../dao/vc.dao');
jest.mock('../../dao/application.dao');
jest.mock('../../dao/programRequirement.dao');
jest.mock('../../dao/ticket.dao');

import ProgramDAOModule from '../../dao/program.dao';
import VCDAOModule from '../../dao/vc.dao';
import ApplicationDAOModule from '../../dao/application.dao';
import ProgramRequirementDAOModule from '../../dao/programRequirement.dao';
import TicketDAOModule from '../../dao/ticket.dao';
import { app } from '../../app';
import { generateProgram } from '../fixtures/faker';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';
import { programs } from '../mock/programs';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ProgramDAO = ProgramDAOModule as unknown as MockedDAO;
const VCDAO = VCDAOModule as unknown as MockedDAO;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;
const ProgramRequirementDAO =
  ProgramRequirementDAOModule as unknown as MockedDAO;
const TicketDAO = TicketDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('GET /api/programs (full stack)', () => {
  it('should return paginated programs from the DAO', async () => {
    ProgramDAO.findProgramsPaginated.mockResolvedValue([
      programs,
      programs.length
    ]);

    const resp = await requestWithSupertest
      .get('/api/programs')
      .set('tenantId', TENANT_ID);
    const { success, data, total, page, limit } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data).toEqual(expect.any(Array));
    expect(total).toBe(programs.length);
    expect(page).toBe(1);
    expect(limit).toBe(20);
    expect(data.length).toBe(programs.length);
  });

  it('should pass page and limit query params down to the DAO', async () => {
    ProgramDAO.findProgramsPaginated.mockResolvedValue([
      programs.slice(0, 2),
      programs.length
    ]);

    const resp = await requestWithSupertest
      .get('/api/programs?page=1&limit=2')
      .set('tenantId', TENANT_ID);
    const { data, total, page, limit } = resp.body;

    expect(resp.status).toBe(200);
    expect(data.length).toBe(2);
    expect(total).toBe(programs.length);
    expect(page).toBe(1);
    expect(limit).toBe(2);
    expect(ProgramDAO.findProgramsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, limit: 2 })
    );
  });

  it('should pass a global search term into the DAO filter', async () => {
    ProgramDAO.findProgramsPaginated.mockResolvedValue([[], 0]);

    await requestWithSupertest
      .get('/api/programs?search=UniqueSearchableSchool')
      .set('tenantId', TENANT_ID);

    const arg = ProgramDAO.findProgramsPaginated.mock.calls[0][0];
    const serialized = JSON.stringify(arg.filter);
    expect(serialized).toContain('UniqueSearchableSchool');
  });

  it('should pass column filters into the DAO filter', async () => {
    ProgramDAO.findProgramsPaginated.mockResolvedValue([[], 0]);

    await requestWithSupertest
      .get(
        `/api/programs?school=${encodeURIComponent(
          'ColumnFilterSchool'
        )}&country=de`
      )
      .set('tenantId', TENANT_ID);

    const arg = ProgramDAO.findProgramsPaginated.mock.calls[0][0];
    const serialized = JSON.stringify(arg.filter);
    expect(serialized).toContain('ColumnFilterSchool');
    expect(serialized).toContain('de');
  });
});

describe('POST /api/programs (full stack)', () => {
  it('should create a program via the DAO with trimmed fields', async () => {
    const { _id, ...fields } = generateProgram();
    // No duplicate exists.
    ProgramDAO.findPrograms.mockResolvedValue([]);
    ProgramDAO.createProgram.mockImplementation((payload) =>
      Promise.resolve({ _id: 'created-id', ...payload })
    );

    const resp = await requestWithSupertest.post('/api/programs').send(fields);
    const { success, data } = resp.body;

    expect(resp.status).toBe(201);
    expect(success).toBe(true);
    expect(data._id).toBeTruthy();
    expect(data.school).toBe(fields.school.trim());
    expect(ProgramDAO.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        school: fields.school.trim(),
        program_name: fields.program_name.trim(),
        whoupdated: `${admin.firstname} ${admin.lastname}`
      })
    );
  });

  it('should 403 when a duplicate program already exists', async () => {
    const { _id, ...fields } = generateProgram();
    ProgramDAO.findPrograms.mockResolvedValue([{ _id: 'dupe' }]);

    const resp = await requestWithSupertest.post('/api/programs').send(fields);

    expect(resp.status).toBe(403);
    expect(ProgramDAO.createProgram).not.toHaveBeenCalled();
  });
});

describe('PUT /api/programs/:id (full stack)', () => {
  it('should update a program and stamp whoupdated', async () => {
    const { _id } = programs[0];
    ProgramDAO.updateProgramOne.mockResolvedValue({
      _id,
      program_name: 'Renamed Program',
      school: programs[0].school,
      degree: programs[0].degree,
      whoupdated: `${admin.firstname} ${admin.lastname}`
    });
    ProgramDAO.updateManyPrograms.mockResolvedValue({ modifiedCount: 0 });
    VCDAO.getVC.mockResolvedValue({ changes: [] });

    const resp = await requestWithSupertest
      .put(`/api/programs/${_id}`)
      .send({ program_name: 'Renamed Program', ml_required: 'no' });
    const { success, data } = resp.body;

    expect(resp.status).toBe(200);
    expect(success).toBe(true);
    expect(data.program_name).toBe('Renamed Program');
    expect(ProgramDAO.updateProgramOne).toHaveBeenCalledWith(
      { _id: _id.toString() },
      expect.objectContaining({
        program_name: 'Renamed Program',
        whoupdated: `${admin.firstname} ${admin.lastname}`
      })
    );
    expect(ProgramDAO.updateManyPrograms).toHaveBeenCalled();
  });

  it('reads the version-control record for the program after updating', async () => {
    const { _id } = programs[0];
    ProgramDAO.updateProgramOne.mockResolvedValue({
      _id,
      program_name: 'VC Characterization Program'
    });
    ProgramDAO.updateManyPrograms.mockResolvedValue({ modifiedCount: 0 });
    VCDAO.getVC.mockResolvedValue({ changes: [{ field: 'program_name' }] });

    const resp = await requestWithSupertest.put(`/api/programs/${_id}`).send({
      program_name: 'VC Characterization Program',
      ml_required: 'yes'
    });

    expect(resp.status).toBe(200);
    expect(VCDAO.getVC).toHaveBeenCalledWith({
      docId: _id.toString(),
      collectionName: 'Program'
    });
    expect(resp.body.vc.changes.length).toBeGreaterThan(0);
  });
});

describe('DELETE /api/programs/:id (full stack)', () => {
  it('should archive a program with no applications', async () => {
    const { _id } = programs[0];
    ApplicationDAO.getApplicationsByProgramId.mockResolvedValue([]);
    ProgramDAO.archiveProgramById.mockResolvedValue({ _id, isArchiv: true });
    ProgramRequirementDAO.deleteOneByProgramIds.mockResolvedValue({
      deletedCount: 0
    });
    TicketDAO.deleteTicketsByProgramId.mockResolvedValue({ deletedCount: 0 });

    const resp = await requestWithSupertest.delete(`/api/programs/${_id}`);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // delete is a soft archive scoped to the program id
    expect(ApplicationDAO.getApplicationsByProgramId).toHaveBeenCalledWith(
      _id.toString()
    );
    expect(ProgramDAO.archiveProgramById).toHaveBeenCalledWith(_id.toString());
    expect(ProgramRequirementDAO.deleteOneByProgramIds).toHaveBeenCalledWith([
      _id.toString()
    ]);
    expect(TicketDAO.deleteTicketsByProgramId).toHaveBeenCalledWith(
      _id.toString()
    );
  });

  it('should 403 (not archive) when applications still reference the program', async () => {
    const { _id } = programs[0];
    ApplicationDAO.getApplicationsByProgramId.mockResolvedValue([
      { studentId: 'student-1' }
    ]);

    const resp = await requestWithSupertest.delete(`/api/programs/${_id}`);

    expect(resp.status).toBe(403);
    expect(ProgramDAO.archiveProgramById).not.toHaveBeenCalled();
  });
});

describe('GET /api/programs/:programId (full stack)', () => {
  it('should return a single program by id (with VC for admins)', async () => {
    const { _id } = programs[0];
    ProgramDAO.getProgramByIdLean.mockResolvedValue(programs[0]);
    VCDAO.getVC.mockResolvedValue({ changes: [] });

    const resp = await requestWithSupertest
      .get(`/api/programs/${_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(_id.toString());
    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledWith(_id.toString());
    expect(VCDAO.getVC).toHaveBeenCalledWith({
      docId: _id.toString(),
      collectionName: 'Program'
    });
  });

  it('should 404 when the program does not exist', async () => {
    const { _id } = programs[0];
    ProgramDAO.getProgramByIdLean.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/programs/${_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
  });
});

describe('GET /api/programs/overview (full stack)', () => {
  it('should return an aggregated programs overview', async () => {
    ProgramDAO.countPrograms.mockResolvedValue(42);
    // Every aggregatePrograms call returns an array; default to [] and let the
    // first (totalSchools) call resolve to a count-shaped doc.
    ProgramDAO.aggregatePrograms.mockResolvedValue([]);
    ProgramDAO.findProgramsQuery.mockResolvedValue([]);
    ApplicationDAO.aggregateApplications.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get('/api/programs/overview')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.totalPrograms).toBe(42);
    expect(Array.isArray(resp.body.data.byCountry)).toBe(true);
    expect(ProgramDAO.countPrograms).toHaveBeenCalledWith({
      isArchiv: { $ne: true }
    });
  });
});

describe('GET /api/programs/same-program-students/:programId (full stack)', () => {
  it('should return students sharing the same program', async () => {
    const { _id } = programs[0];
    ApplicationDAO.getDecidedApplicationsByProgramPopulated.mockResolvedValue([
      {
        studentId: { _id: 'stu1', agents: [] },
        application_year: '2024',
        closed: 'O',
        admission: 'O'
      }
    ]);

    const resp = await requestWithSupertest
      .get(`/api/programs/same-program-students/${_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(
      ApplicationDAO.getDecidedApplicationsByProgramPopulated
    ).toHaveBeenCalledWith(_id.toString());
  });
});
