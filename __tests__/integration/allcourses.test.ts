// Integration test for the all-courses routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/allcourses
//   -> real AllcourseService -> MOCKED AllcourseDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. Fully deterministic —
// no database engine, no seeding.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { subjects, subject1, subject3 } from '../mock/allcourses';
import { agent } from '../mock/user';
import { app } from '../../app';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

const requestWithSupertest = request(app);

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);

// The data boundary: mock the DAO the allcourse service delegates to.
jest.mock('../../dao/allcourse.dao');

import AllcourseDAOModule from '../../dao/allcourse.dao';

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const AllcourseDAO = AllcourseDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = agent;
      next();
    }
  );
});

describe('GET /api/all-courses', () => {
  it('returns all courses from the DAO as an array', async () => {
    AllcourseDAO.getAllcourses.mockResolvedValue(subjects);

    const resp = await requestWithSupertest
      .get('/api/all-courses/')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data).toHaveLength(subjects.length);
    expect(AllcourseDAO.getAllcourses).toHaveBeenCalled();
  });
});

describe('POST /api/all-courses', () => {
  it('creates a course via the DAO and returns the saved record', async () => {
    const saved = {
      _id: 'new-course-id',
      all_course_chinese: '測試',
      all_course_english: 'test'
    };
    AllcourseDAO.createAllcourse.mockResolvedValue(saved);

    const resp = await requestWithSupertest
      .post('/api/all-courses/')
      .set('tenantId', TENANT_ID)
      .send({
        all_course_chinese: '測試',
        all_course_english: 'test'
      });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.all_course_english).toBe('test');
    expect(AllcourseDAO.createAllcourse).toHaveBeenCalledWith(
      expect.objectContaining({
        all_course_chinese: '測試',
        all_course_english: 'test'
      })
    );
  });

  it('rejects a course missing required names with 400 (DAO not called)', async () => {
    const resp = await requestWithSupertest
      .post('/api/all-courses/')
      .set('tenantId', TENANT_ID)
      .send({ all_course_english: 'only english' });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
    expect(AllcourseDAO.createAllcourse).not.toHaveBeenCalled();
  });
});

describe('GET /api/all-courses/:courseId', () => {
  it('returns the course from the DAO, queried by id', async () => {
    AllcourseDAO.getAllcourseById.mockResolvedValue(subject1);

    const resp = await requestWithSupertest
      .get(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(subject1._id.toString());
    expect(AllcourseDAO.getAllcourseById).toHaveBeenCalledWith(
      subject1._id.toString()
    );
  });

  it('returns 404 when the DAO finds no course', async () => {
    AllcourseDAO.getAllcourseById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});

describe('PUT /api/all-courses/:courseId', () => {
  it('updates the course via the DAO and returns the updated record', async () => {
    const updated = {
      _id: subject1._id,
      all_course_chinese: '測試',
      all_course_english: 'updated-english'
    };
    AllcourseDAO.updateAllcourseById.mockResolvedValue(updated);

    const resp = await requestWithSupertest
      .put(`/api/all-courses/${subject1._id}`)
      .set('tenantId', TENANT_ID)
      .send({
        all_course_chinese: '測試',
        all_course_english: 'updated-english'
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.all_course_english).toBe('updated-english');
    expect(AllcourseDAO.updateAllcourseById).toHaveBeenCalledWith(
      subject1._id.toString(),
      expect.objectContaining({
        all_course_chinese: '測試',
        all_course_english: 'updated-english',
        updatedBy: agent._id
      })
    );
  });
});

describe('DELETE /api/all-courses/:courseId', () => {
  it('deletes the course via the DAO scoped to the id', async () => {
    AllcourseDAO.deleteAllcourseById.mockResolvedValue({ _id: subject3._id });

    const resp = await requestWithSupertest
      .delete(`/api/all-courses/${subject3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(AllcourseDAO.deleteAllcourseById).toHaveBeenCalledWith(
      subject3._id.toString()
    );
  });

  it('returns 404 when the DAO finds no course to delete', async () => {
    AllcourseDAO.deleteAllcourseById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .delete(`/api/all-courses/${subject3._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(resp.body.success).toBe(false);
  });
});
