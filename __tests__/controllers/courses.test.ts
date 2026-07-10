// Controller UNIT test for controllers/course (the courses routes).
//
// The handlers are plain (req, res, next) functions, so we call them DIRECTLY
// with fake req/res/next and MOCKED collaborators (CourseService, StudentService,
// the email module and the AWS helpers the analyse/download handlers call). No
// route, no middleware, no database — only the controller's own work:
//   - what it pulls off req (params/body/user),
//   - the args it forwards to the service,
//   - the status + body it writes to res,
//   - that it forwards a service error to next().
// Route + middleware wiring + real persistence is covered by
// __tests__/integration/courses.test.js.

jest.mock('../../services/course');
jest.mock('../../services/students');
jest.mock('../../services/email', () => ({
  updateCoursesDataAgentEmail: jest.fn(),
  AnalysedCoursesDataStudentEmail: jest.fn()
}));
// The analyse/download handlers call AWS; keep them out of the unit test.
jest.mock('../../aws', () => ({
  getTemporaryCredentials: jest
    .fn()
    .mockResolvedValue({ Credentials: { AccessKeyId: 'x' } }),
  callApiGateway: jest.fn().mockResolvedValue({ result: { ok: true } })
}));
jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn().mockResolvedValue(Buffer.from('{}')),
  uploadJsonToS3: jest.fn().mockResolvedValue(undefined)
}));

import CourseServiceModule from '../../services/course';
import StudentServiceModule from '../../services/students';
import { getS3Object } from '../../aws/s3';
import CourseController from '../../controllers/course';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, student } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const CourseService = CourseServiceModule as unknown as MockedModule;
const StudentService = StudentServiceModule as unknown as MockedModule;
// getS3Object is a named auto-mocked function (not a full module object);
// cast it to jest.Mock for the per-test `.mockResolvedValue()` calls.
const asMock = (fn: unknown) => fn as jest.Mock;

// The controller module uses `export =`, so its members are destructured off
// the default-imported object; the handlers themselves are asyncHandler-wrapped
// (req, res) functions, but tests call them with an extra `next` arg for the
// forward-to-next() cases, so re-type each as a variadic handler.
type ControllerHandler = (...args: unknown[]) => Promise<unknown>;
const {
  getMycourses,
  putMycourses,
  deleteMyCourse,
  downloadJson,
  processTranscript_api_gatway
} = CourseController as unknown as Record<string, ControllerHandler>;

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getMycourses', () => {
  it('responds with the persisted courses when the student has a record', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue({
      _id: studentId,
      firstname: 'Ann',
      lastname: 'Smith'
    });
    const courses = {
      student_id: studentId,
      table_data_string: '[{"course_chinese":"微積分"}]'
    };
    CourseService.getCourse.mockResolvedValue(courses);
    const res = mockRes();

    await getMycourses(mockReq({ params: { studentId } }), res, jest.fn());

    expect(StudentService.getStudentByIdLean).toHaveBeenCalledWith(studentId);
    expect(CourseService.getCourse).toHaveBeenCalledWith({
      student_id: studentId
    });
    expect(res.send).toHaveBeenCalledWith({ success: true, data: courses });
  });

  it('responds with default example course data when no record exists', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue({
      _id: studentId,
      firstname: 'Ann',
      lastname: 'Smith',
      agents: [],
      editors: [],
      archiv: false
    });
    CourseService.getCourse.mockResolvedValue(null);
    const res = mockRes();

    await getMycourses(mockReq({ params: { studentId } }), res, jest.fn());

    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.table_data_string).toContain('(Example)');
    expect(body.data.table_data_string_locked).toBe(false);
  });

  it('forwards a 500 ErrorResponse to next() when the student does not exist', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue(null);
    const next = jest.fn();

    await getMycourses(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500 });
    expect(CourseService.getCourse).not.toHaveBeenCalled();
  });
});

describe('putMycourses', () => {
  it('upserts with the body (stamped updatedAt) and responds with the result', async () => {
    const saved = {
      student_id: { firstname: 'Ann', lastname: 'Smith' },
      table_data_string: '[{"course_chinese":"電子學一"}]'
    };
    CourseService.upsertCourseByStudentId.mockResolvedValue(saved);
    const res = mockRes();

    await putMycourses(
      mockReq({
        params: { studentId },
        body: { table_data_string: '[{"course_chinese":"電子學一"}]' },
        user: admin
      }),
      res,
      jest.fn()
    );

    expect(CourseService.upsertCourseByStudentId).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        table_data_string: '[{"course_chinese":"電子學一"}]',
        updatedAt: expect.any(Date)
      })
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: saved });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    CourseService.upsertCourseByStudentId.mockRejectedValue(err);
    const next = jest.fn();

    await putMycourses(
      mockReq({ params: { studentId }, body: {}, user: admin }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('deleteMyCourse', () => {
  it('deletes the course when one exists and responds 200', async () => {
    CourseService.getCourse.mockResolvedValue({ student_id: studentId });
    CourseService.deleteCourse.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteMyCourse(mockReq({ params: { studentId } }), res, jest.fn());

    expect(CourseService.deleteCourse).toHaveBeenCalledWith({
      student_id: studentId
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse to next() when there is no course', async () => {
    CourseService.getCourse.mockResolvedValue(null);
    const next = jest.fn();

    await deleteMyCourse(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
    expect(CourseService.deleteCourse).not.toHaveBeenCalled();
  });
});

describe('downloadJson', () => {
  it('responds 200 with the parsed analysed json from S3', async () => {
    CourseService.getCourse.mockResolvedValue({
      student_id: { _id: studentId },
      analysis: { isAnalysedV2: true, pathV2: `${studentId}/analysed.json` }
    });
    asMock(getS3Object).mockResolvedValue(Buffer.from('{"score":5}'));
    const res = mockRes();

    await downloadJson(mockReq({ params: { studentId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.json).toEqual({ score: 5 });
  });

  it('forwards a 404 ErrorResponse to next() when the course is missing', async () => {
    CourseService.getCourse.mockResolvedValue(null);
    const next = jest.fn();

    await downloadJson(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });

  it('forwards a 403 ErrorResponse to next() when not analysed yet', async () => {
    CourseService.getCourse.mockResolvedValue({
      student_id: { _id: studentId },
      analysis: { isAnalysedV2: false, pathV2: null }
    });
    const next = jest.fn();

    await downloadJson(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
});

describe('processTranscript_api_gatway', () => {
  it('short-circuits with empty data when the student has no course', async () => {
    CourseService.getCourse.mockResolvedValue(null);
    const res = mockRes();

    await processTranscript_api_gatway(
      mockReq({
        params: { studentId, language: 'en' },
        body: { requirementIds: [], factor: 1.5 }
      }),
      res,
      jest.fn()
    );

    expect(res.send).toHaveBeenCalledWith({ success: true, data: {} });
    expect(CourseService.updateCourse).not.toHaveBeenCalled();
  });
});
