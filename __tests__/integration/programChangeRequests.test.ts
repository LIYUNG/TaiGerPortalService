// Integration test for the program change-request routes — HTTP boundary down to
// the service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real
//   controllers/programChangeRequests -> real ProgramChangeRequestService /
//   ProgramService -> MOCKED ProgramChangeRequestDAO / ProgramDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual
// schema/query/upsert construction is covered by the DAO unit tests. Fully
// deterministic — no engine flake.

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

// The data boundary: mock the DAOs the change-request/program services delegate to.
jest.mock('../../dao/programChangeRequest.dao');
jest.mock('../../dao/program.dao');

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
const { ObjectId } = require('mongoose').Types;
import ProgramChangeRequestDAOModule from '../../dao/programChangeRequest.dao';
import ProgramDAOModule from '../../dao/program.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ProgramChangeRequestDAO =
  ProgramChangeRequestDAOModule as unknown as MockedDAO;
const ProgramDAO = ProgramDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);
const programId = new ObjectId().toHexString();

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('POST /api/programs/:programId/change-requests', () => {
  it('upserts a change request for an existing program', async () => {
    ProgramDAO.getProgramByIdLean.mockResolvedValue({ _id: programId });
    ProgramChangeRequestDAO.upsertChangeRequest.mockResolvedValue({
      _id: new ObjectId(),
      programId,
      requestedBy: admin._id,
      programChanges: { program_name: 'Updated Program Name' }
    });

    const resp = await requestWithSupertest
      .post(`/api/programs/${programId}/change-requests`)
      .set('tenantId', TENANT_ID)
      .send({ program_name: 'Updated Program Name' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledWith(programId);
    expect(ProgramChangeRequestDAO.upsertChangeRequest).toHaveBeenCalledWith(
      programId,
      admin._id,
      { program_name: 'Updated Program Name' }
    );
  });

  it('returns 404 when the program does not exist', async () => {
    ProgramDAO.getProgramByIdLean.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .post(`/api/programs/${programId}/change-requests`)
      .set('tenantId', TENANT_ID)
      .send({ program_name: 'Whatever' });

    expect(resp.status).toBe(404);
    expect(ProgramChangeRequestDAO.upsertChangeRequest).not.toHaveBeenCalled();
  });
});

describe('GET /api/programs/:programId/change-requests', () => {
  it('returns the open change requests the DAO reports for the program', async () => {
    const changeRequests = [
      {
        _id: new ObjectId(),
        programId,
        programChanges: { program_name: 'Updated Program Name' }
      }
    ];
    ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId.mockResolvedValue(
      changeRequests
    );

    const resp = await requestWithSupertest
      .get(`/api/programs/${programId}/change-requests`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(1);
    expect(
      ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId
    ).toHaveBeenCalledWith(programId);
    expect(resp.body.data[0].programChanges.program_name).toBe(
      'Updated Program Name'
    );
  });

  it('returns 404 when the DAO reports no change requests (falsy)', async () => {
    ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId.mockResolvedValue(
      null
    );

    const resp = await requestWithSupertest
      .get(`/api/programs/${programId}/change-requests`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
  });
});

describe('POST /api/programs/review-changes/:requestId', () => {
  it('marks an open change request as reviewed and persists the reviewer', async () => {
    const requestId = new ObjectId().toHexString();
    ProgramChangeRequestDAO.getChangeRequestById.mockResolvedValue({
      _id: requestId,
      programId,
      reviewedBy: undefined
    });
    ProgramChangeRequestDAO.updateChangeRequestById.mockImplementation(
      (id, payload) => Promise.resolve({ _id: id, ...payload })
    );

    const resp = await requestWithSupertest
      .post(`/api/programs/review-changes/${requestId}`)
      .set('tenantId', TENANT_ID)
      .send();

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.reviewedBy.toString()).toBe(admin._id.toString());
    expect(resp.body.data.reviewedAt).toBeDefined();
    expect(ProgramChangeRequestDAO.getChangeRequestById).toHaveBeenCalledWith(
      requestId
    );
    expect(
      ProgramChangeRequestDAO.updateChangeRequestById
    ).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({ reviewedBy: admin._id })
    );
  });

  it('returns 404 when the change request does not exist', async () => {
    const requestId = new ObjectId().toHexString();
    ProgramChangeRequestDAO.getChangeRequestById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .post(`/api/programs/review-changes/${requestId}`)
      .set('tenantId', TENANT_ID)
      .send();

    expect(resp.status).toBe(404);
    expect(
      ProgramChangeRequestDAO.updateChangeRequestById
    ).not.toHaveBeenCalled();
  });

  it('returns 400 when the change request was already reviewed', async () => {
    const requestId = new ObjectId().toHexString();
    ProgramChangeRequestDAO.getChangeRequestById.mockResolvedValue({
      _id: requestId,
      programId,
      reviewedBy: admin._id,
      reviewedAt: new Date()
    });

    const resp = await requestWithSupertest
      .post(`/api/programs/review-changes/${requestId}`)
      .set('tenantId', TENANT_ID)
      .send();

    expect(resp.status).toBe(400);
    expect(
      ProgramChangeRequestDAO.updateChangeRequestById
    ).not.toHaveBeenCalled();
  });
});
