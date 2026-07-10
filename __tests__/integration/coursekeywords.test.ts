// Integration test for the course-keywords routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/coursekeywords
//   -> real KeywordSetService -> MOCKED KeywordSetDAO / ProgramRequirementDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query construction is covered by the DAO unit tests. Fully deterministic —
// no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { subjects, subject1, subject2 } from '../mock/allcourses';
import { agent } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);

// The data boundary: mock the DAOs the keyword-set service delegates to.
jest.mock('../../dao/keywordset.dao');
jest.mock('../../dao/programRequirement.dao');

import KeywordSetDAOModule from '../../dao/keywordset.dao';
import ProgramRequirementDAOModule from '../../dao/programRequirement.dao';
import { app } from '../../app';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const KeywordSetDAO = KeywordSetDAOModule as unknown as MockedDAO;
const ProgramRequirementDAO =
  ProgramRequirementDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = agent;
      next();
    }
  );
});

describe('GET /api/course-keywords', () => {
  it('returns all keyword sets from the DAO', async () => {
    KeywordSetDAO.getKeywordSets.mockResolvedValue(subjects);

    const resp = await requestWithSupertest
      .get('/api/course-keywords/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(subjects.length);
    expect(KeywordSetDAO.getKeywordSets).toHaveBeenCalled();
  });
});

describe('POST /api/course-keywords/:keywordsSetId', () => {
  it('creates a new keyword set and returns it', async () => {
    const fields = {
      categoryName: 'categoryName_new',
      description: 'keyowrd_description',
      keywords: { zh: ['123'], en: ['abc'] },
      antiKeywords: { zh: ['123'], en: ['abc'] }
    };
    // No existing duplicate, then create returns the saved record.
    KeywordSetDAO.findKeywordSet.mockResolvedValue(null);
    KeywordSetDAO.createKeywordSet.mockResolvedValue({
      _id: subject1._id,
      ...fields
    });

    const resp = await requestWithSupertest
      .post(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send(fields);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.categoryName).toBe('categoryName_new');
    expect(KeywordSetDAO.findKeywordSet).toHaveBeenCalled();
    expect(KeywordSetDAO.createKeywordSet).toHaveBeenCalledWith(
      expect.objectContaining({ categoryName: 'categoryName_new' })
    );
  });

  it('423s when a duplicate keyword set already exists', async () => {
    const fields = {
      categoryName: 'categoryName_new',
      description: 'keyowrd_description',
      keywords: { zh: ['123'], en: ['abc'] },
      antiKeywords: { zh: ['123'], en: ['abc'] }
    };
    KeywordSetDAO.findKeywordSet.mockResolvedValue({
      keywords: { zh: ['123'], en: ['abc'] },
      antiKeywords: { zh: ['123'], en: ['abc'] }
    });

    const resp = await requestWithSupertest
      .post(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send(fields);

    expect(resp.status).toBe(423);
    expect(KeywordSetDAO.createKeywordSet).not.toHaveBeenCalled();
  });
});

describe('PUT /api/course-keywords/:keywordsSetId', () => {
  it('updates the keyword set via the DAO and returns the saved record', async () => {
    KeywordSetDAO.updateKeywordSetById.mockResolvedValue({
      _id: subject1._id,
      categoryName: 'categoryName_updated'
    });

    const put = await requestWithSupertest
      .put(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ categoryName: 'categoryName_updated' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.data.categoryName).toBe('categoryName_updated');
    expect(KeywordSetDAO.updateKeywordSetById).toHaveBeenCalledWith(
      subject1._id.toString(),
      expect.objectContaining({ categoryName: 'categoryName_updated' })
    );
  });

  it('404s when the DAO updates no record', async () => {
    KeywordSetDAO.updateKeywordSetById.mockResolvedValue(null);

    const put = await requestWithSupertest
      .put(`/api/course-keywords/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({ categoryName: 'categoryName_updated' });

    expect(put.status).toBe(404);
  });
});

describe('DELETE /api/course-keywords/:keywordsSetId', () => {
  it('deletes the keyword set and removes its references', async () => {
    KeywordSetDAO.deleteKeywordSetById.mockResolvedValue({ deletedCount: 1 });
    ProgramRequirementDAO.removeKeywordSetReferences.mockResolvedValue({});

    const del = await requestWithSupertest
      .delete(`/api/course-keywords/${subject2._id}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    expect(KeywordSetDAO.deleteKeywordSetById).toHaveBeenCalledWith(
      subject2._id.toString()
    );
    expect(
      ProgramRequirementDAO.removeKeywordSetReferences
    ).toHaveBeenCalledWith(subject2._id.toString());
  });
});
