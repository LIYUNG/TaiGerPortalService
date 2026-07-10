// Integration test for the courses routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/course ->
//   real CourseService / StudentService -> MOCKED CourseDAO / StudentDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query/aggregation construction is covered by the DAO unit tests
// (__tests__/dao/course.dao.test.js). Fully deterministic — no engine flake.

import request from 'supertest';
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
jest.mock('../../middlewares/auth', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.authMock({ localAuth: mw.passthroughFn() });
});

// putMycourses notifies agents by email after the upsert; stub the senders so no
// SMTP connection is opened.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  updateCoursesDataAgentEmail: jest.fn(),
  AnalysedCoursesDataStudentEmail: jest.fn()
}));

// The data boundary: mock the DAOs the course/student services delegate to.
jest.mock('../../dao/course.dao');
jest.mock('../../dao/student.dao');

import CourseDAOModule from '../../dao/course.dao';
import StudentDAOModule from '../../dao/student.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { student } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const CourseDAO = CourseDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);
const studentId = student._id.toString();

const EXAMPLE_TABLE =
  '[{"course_chinese":"(Example)物理一","course_english":null,"credits":"2","grades":"73"},{"course_chinese":"(Example)微積分一","course_english":null,"credits":"2","grades":"77"}]';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the logged-in user is the student themselves.
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = student;
      next();
    }
  );
  // Sensible defaults; individual tests override as needed.
  StudentDAO.getStudentByIdLean.mockResolvedValue({
    _id: student._id,
    firstname: student.firstname,
    lastname: student.lastname,
    agents: [],
    editors: [],
    archiv: false
  });
  StudentDAO.getStudentByIdWithAgents.mockResolvedValue({
    agents: [],
    archiv: false
  });
});

describe('GET /api/courses/:studentId', () => {
  it('returns the course record from the DAO, queried by student id', async () => {
    const course = { student_id: studentId, table_data_string: EXAMPLE_TABLE };
    CourseDAO.getCourse.mockResolvedValue(course);

    const resp = await requestWithSupertest
      .get(`/api/courses/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(CourseDAO.getCourse).toHaveBeenCalledWith({ student_id: studentId });
    expect(resp.body.data.table_data_string).toContain('(Example)微積分一');
  });

  it('returns the default example payload when the DAO finds no record', async () => {
    CourseDAO.getCourse.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/courses/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.table_data_string).toContain('(Example)');
  });

  it('500s when the student does not exist', async () => {
    StudentDAO.getStudentByIdLean.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/courses/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(500);
    expect(CourseDAO.getCourse).not.toHaveBeenCalled();
  });
});

describe('PUT /api/courses/:studentId', () => {
  it('upserts via the DAO with the posted fields and returns the saved record', async () => {
    const newTable =
      '[{"course_chinese":"電子學一","course_english":"Electronics I","credits":"2","grades":"73"}]';
    const saved = {
      student_id: {
        _id: student._id,
        firstname: student.firstname,
        lastname: student.lastname
      },
      table_data_string: newTable
    };
    CourseDAO.upsertCourseByStudentId.mockResolvedValue(saved);

    const put = await requestWithSupertest
      .put(`/api/courses/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ table_data_string: newTable });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(CourseDAO.upsertCourseByStudentId).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({ table_data_string: newTable })
    );
    expect(put.body.data.table_data_string).toBe(newTable);
  });
});

describe('DELETE /api/courses/:studentId', () => {
  it('deletes the course via the DAO scoped to the student', async () => {
    // deleteMyCourse first checks existence via getCourse, then deletes.
    CourseDAO.getCourse.mockResolvedValue({
      student_id: studentId,
      table_data_string: EXAMPLE_TABLE
    });
    CourseDAO.deleteCourse.mockResolvedValue({ deletedCount: 1 });

    const del = await requestWithSupertest
      .delete(`/api/courses/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    expect(CourseDAO.deleteCourse).toHaveBeenCalledWith({
      student_id: studentId
    });
  });
});
