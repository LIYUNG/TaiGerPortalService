// Integration test for the program-requirements routes — HTTP boundary down to
// the service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware ->
//   real controllers/program_requirements -> real ProgramRequirementService ->
//   MOCKED ProgramRequirementDAO / ProgramDAO / KeywordSetDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual
// schema/query construction is covered by the DAO unit tests. Fully
// deterministic — no engine flake.

import type { Request, Response, NextFunction } from 'express';

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/auth', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.authMock({ localAuth: mw.passthroughFn() });
});

// The data boundary: mock the DAOs the program-requirement service composes.
jest.mock('../../dao/programRequirement.dao');
jest.mock('../../dao/program.dao');
jest.mock('../../dao/keywordset.dao');

import request from 'supertest';
import ProgramRequirementDAOModule from '../../dao/programRequirement.dao';
import ProgramDAOModule from '../../dao/program.dao';
import KeywordSetDAOModule from '../../dao/keywordset.dao';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';
import { app } from '../../app';
import { program4 } from '../mock/programs';
import {
  programRequirements1,
  programRequirements2,
  programRequirementss,
  programRequirementsNew
} from '../mock/programRequirements';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ProgramRequirementDAO =
  ProgramRequirementDAOModule as unknown as MockedDAO;
const ProgramDAO = ProgramDAOModule as unknown as MockedDAO;
const KeywordSetDAO = KeywordSetDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
  // Sensible defaults for the distinct-programs/keyword bundle reads.
  ProgramDAO.getDistinctSchoolProgramDegree.mockResolvedValue([]);
  KeywordSetDAO.getKeywordSets.mockResolvedValue([]);
});

describe('GET /api/program-requirements/', () => {
  it('returns the program requirements the DAO reports', async () => {
    ProgramRequirementDAO.getProgramRequirements.mockResolvedValue(
      programRequirementss
    );

    const resp = await requestWithSupertest
      .get('/api/program-requirements/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(ProgramRequirementDAO.getProgramRequirements).toHaveBeenCalled();
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(programRequirementss.length);
  });
});

describe('GET /api/program-requirements/programs-and-keywords/', () => {
  it('returns distinct programs and keyword sets from the DAOs', async () => {
    ProgramDAO.getDistinctSchoolProgramDegree.mockResolvedValue([
      { school: 'A', program_name: 'P', degree: 'M' }
    ]);
    KeywordSetDAO.getKeywordSets.mockResolvedValue([{ _id: 'k1' }]);

    const resp = await requestWithSupertest
      .get('/api/program-requirements/programs-and-keywords')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(ProgramDAO.getDistinctSchoolProgramDegree).toHaveBeenCalled();
    expect(KeywordSetDAO.getKeywordSets).toHaveBeenCalled();
    expect(resp.body.data.distinctPrograms.length).toBe(1);
    expect(resp.body.data.keywordsets.length).toBe(1);
  });
});

describe('POST /api/program-requirements/new/', () => {
  it('creates a program requirement when none exists for the matched programs', async () => {
    const matchedPrograms = [{ _id: program4._id }];
    ProgramDAO.findProgramsBySchoolNameDegree.mockResolvedValue(
      matchedPrograms
    );
    ProgramRequirementDAO.getProgramRequirementsByProgramIds.mockResolvedValue(
      []
    );
    ProgramRequirementDAO.createProgramRequirement.mockImplementation(
      (payload) => Promise.resolve({ _id: 'new-req-id', ...payload })
    );

    const resp = await requestWithSupertest
      .post('/api/program-requirements/new/')
      .set('tenantId', TENANT_ID)
      .send({
        ...programRequirementsNew,
        program: {
          school: program4.school,
          program_name: program4.program_name,
          degree: program4.degree
        }
      });

    expect(resp.status).toEqual(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id).toBeTruthy();
    expect(ProgramDAO.findProgramsBySchoolNameDegree).toHaveBeenCalledWith({
      school: program4.school,
      program_name: program4.program_name,
      degree: program4.degree
    });
    expect(
      ProgramRequirementDAO.getProgramRequirementsByProgramIds
    ).toHaveBeenCalledWith([program4._id]);
    // The handler spreads the posted fields over the matched programId, so the
    // body's program_categories/keywordSets shape reaches the DAO.
    expect(ProgramRequirementDAO.createProgramRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        program_categories: expect.any(Array)
      })
    );
  });

  it('returns 423 when a requirement already exists for the matched programs', async () => {
    ProgramDAO.findProgramsBySchoolNameDegree.mockResolvedValue([
      { _id: program4._id }
    ]);
    ProgramRequirementDAO.getProgramRequirementsByProgramIds.mockResolvedValue([
      { _id: 'existing' }
    ]);

    const resp = await requestWithSupertest
      .post('/api/program-requirements/new/')
      .set('tenantId', TENANT_ID)
      .send({
        ...programRequirementsNew,
        program: {
          school: program4.school,
          program_name: program4.program_name,
          degree: program4.degree
        }
      });

    expect(resp.status).toEqual(423);
    expect(
      ProgramRequirementDAO.createProgramRequirement
    ).not.toHaveBeenCalled();
  });
});

describe('GET /api/program-requirements/:requirementId', () => {
  it('returns the requested requirement bundled with distinct programs/keywords', async () => {
    ProgramRequirementDAO.getProgramRequirementById.mockResolvedValue(
      programRequirements1
    );

    const resp = await requestWithSupertest
      .get(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(
      ProgramRequirementDAO.getProgramRequirementById
    ).toHaveBeenCalledWith(programRequirements1._id.toString());
    expect(resp.body.data.requirement._id.toString()).toBe(
      programRequirements1._id.toString()
    );
    expect(resp.body.data).toHaveProperty('distinctPrograms');
    expect(resp.body.data).toHaveProperty('keywordsets');
  });

  it('returns 404 when the requirement does not exist', async () => {
    ProgramRequirementDAO.getProgramRequirementById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(404);
  });
});

describe('PUT /api/program-requirements/:requirementId', () => {
  it('updates the requirement and returns the DAO result', async () => {
    ProgramRequirementDAO.updateProgramRequirementById.mockResolvedValue({
      _id: programRequirements1._id,
      admissionDescription: 'modified_description'
    });

    const resp = await requestWithSupertest
      .put(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ admissionDescription: 'modified_description' });

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(
      ProgramRequirementDAO.updateProgramRequirementById
    ).toHaveBeenCalledWith(
      programRequirements1._id.toString(),
      expect.objectContaining({ admissionDescription: 'modified_description' })
    );
    expect(resp.body.data.admissionDescription).toBe('modified_description');
  });

  it('returns 404 when the requirement to update does not exist', async () => {
    ProgramRequirementDAO.updateProgramRequirementById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .put(`/api/program-requirements/${programRequirements1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ admissionDescription: 'modified_description' });

    expect(resp.status).toEqual(404);
  });
});

describe('DELETE /api/program-requirements/:requirementId', () => {
  it('deletes the requirement via the DAO scoped to the id', async () => {
    ProgramRequirementDAO.deleteProgramRequirementById.mockResolvedValue({
      deletedCount: 1
    });

    const resp = await requestWithSupertest
      .delete(`/api/program-requirements/${programRequirements2._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toEqual(200);
    expect(resp.body.success).toBe(true);
    expect(
      ProgramRequirementDAO.deleteProgramRequirementById
    ).toHaveBeenCalledWith(programRequirements2._id.toString());
  });
});
