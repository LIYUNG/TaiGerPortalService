// Controller UNIT test for controllers/course.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and MOCKED collaborators
// (CourseService, StudentService, the email module and the AWS helpers the
// analyse/download handlers call). No route, no middleware, no database — only
// the controller's own work: what it pulls off req (params/body/user), the args
// it forwards to the service, the status + body it writes, the role branches it
// owns, and that it forwards a service error to next().
//
// This suite aims for full statement coverage of controllers/course.js,
// exercising EVERY handler plus their success / error / role branches.

jest.mock('../../services/course');
jest.mock('../../services/students');
jest.mock('../../services/email', () => ({
  updateCoursesDataAgentEmail: jest.fn(),
  AnalysedCoursesDataStudentEmail: jest.fn()
}));
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

import CourseService from '../../services/course';
import StudentService from '../../services/students';
import { getS3Object, uploadJsonToS3 } from '../../aws/s3';
import { getTemporaryCredentials, callApiGateway } from '../../aws';
import { updateCoursesDataAgentEmail } from '../../services/email';
import {
  getMycourses,
  putMycourses,
  deleteMyCourse,
  downloadJson,
  processTranscript_api_gatway
} from '../../controllers/course';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, student } from '../mock/user';

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
    expect(body.data.student_id._id).toBe(studentId);
  });

  it('forwards a 500 ErrorResponse to next() when the student does not exist', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue(null);
    const next = jest.fn();

    await getMycourses(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500 });
    expect(CourseService.getCourse).not.toHaveBeenCalled();
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.getStudentByIdLean.mockRejectedValue(err);
    const next = jest.fn();

    await getMycourses(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('putMycourses', () => {
  it('non-student (admin): upserts without stripping the locked flag and does NOT email agents', async () => {
    const saved = {
      student_id: { firstname: 'Ann', lastname: 'Smith' },
      table_data_string: '[{"course_chinese":"電子學一"}]'
    };
    CourseService.upsertCourseByStudentId.mockResolvedValue(saved);
    const res = mockRes();

    await putMycourses(
      mockReq({
        params: { studentId },
        body: {
          table_data_string: '[{"course_chinese":"電子學一"}]',
          table_data_string_locked: true
        },
        user: admin
      }),
      res,
      jest.fn()
    );

    const fields = CourseService.upsertCourseByStudentId.mock.calls[0][1];
    // Admin keeps the locked flag.
    expect(fields.table_data_string_locked).toBe(true);
    expect(fields.updatedAt).toBeInstanceOf(Date);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: saved });
    // No agent notification for a non-student writer.
    expect(StudentService.getStudentByIdWithAgents).not.toHaveBeenCalled();
    expect(updateCoursesDataAgentEmail).not.toHaveBeenCalled();
  });

  it('student writer: strips the locked flag and emails each (non-archived) agent', async () => {
    const saved = {
      student_id: { firstname: 'Stu', lastname: 'Dent' },
      table_data_string: '[{"course_chinese":"物理一"}]'
    };
    CourseService.upsertCourseByStudentId.mockResolvedValue(saved);
    StudentService.getStudentByIdWithAgents.mockResolvedValue({
      archiv: false,
      agents: [
        { firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io' },
        { firstname: 'Ag2', lastname: 'Ent2', email: 'ag2@x.io' }
      ]
    });
    const res = mockRes();

    await putMycourses(
      mockReq({
        params: { studentId },
        body: {
          table_data_string: '[{"course_chinese":"物理一"}]',
          table_data_string_locked: true
        },
        user: student
      }),
      res,
      jest.fn()
    );

    const fields = CourseService.upsertCourseByStudentId.mock.calls[0][1];
    // Student cannot set the locked flag.
    expect(fields).not.toHaveProperty('table_data_string_locked');
    expect(res.send).toHaveBeenCalledWith({ success: true, data: saved });
    expect(StudentService.getStudentByIdWithAgents).toHaveBeenCalledWith(
      studentId
    );
    expect(updateCoursesDataAgentEmail).toHaveBeenCalledTimes(2);
  });

  it('student writer with an archived student: skips the agent email', async () => {
    CourseService.upsertCourseByStudentId.mockResolvedValue({
      student_id: { firstname: 'Stu', lastname: 'Dent' }
    });
    StudentService.getStudentByIdWithAgents.mockResolvedValue({
      archiv: true,
      agents: [{ firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io' }]
    });
    const res = mockRes();

    await putMycourses(
      mockReq({
        params: { studentId },
        body: { table_data_string: '[]' },
        user: student
      }),
      res,
      jest.fn()
    );

    expect(res.send.mock.calls[0][0].success).toBe(true);
    expect(updateCoursesDataAgentEmail).not.toHaveBeenCalled();
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
    getS3Object.mockResolvedValue(Buffer.from('{"score":5}'));
    const res = mockRes();

    await downloadJson(mockReq({ params: { studentId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.json).toEqual({ score: 5 });
    expect(body.fileKey).toBeDefined();
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

  it('200: analyses the transcript, uploads to S3, updates the course and returns analysis', async () => {
    const analysis = { isAnalysedV2: false };
    CourseService.getCourse.mockResolvedValue({
      student_id: { firstname: 'Ann Marie', lastname: 'Smith' },
      table_data_string: '[{"c":1}]',
      table_data_string_taiger_guided: '[]',
      analysis
    });
    callApiGateway.mockResolvedValue({ result: { score: 9 } });
    uploadJsonToS3.mockResolvedValue(undefined);
    CourseService.updateCourse.mockResolvedValue({});
    const res = mockRes();

    await processTranscript_api_gatway(
      mockReq({
        params: { studentId, language: 'en' },
        body: { requirementIds: ['r1'], factor: 2 }
      }),
      res,
      jest.fn()
    );

    expect(getTemporaryCredentials).toHaveBeenCalled();
    // student_name has its spaces replaced with hyphens.
    const apigArgs = callApiGateway.mock.calls[0][3];
    expect(apigArgs.student_name).toBe('Ann-Marie_Smith');
    expect(apigArgs.factor).toBe(2);
    expect(uploadJsonToS3).toHaveBeenCalled();
    expect(CourseService.updateCourse).toHaveBeenCalledWith(
      { student_id: studentId },
      expect.objectContaining({
        analysis: expect.objectContaining({ isAnalysedV2: true })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: analysis });
  });

  it('defaults the factor to 1.5 when none is provided', async () => {
    CourseService.getCourse.mockResolvedValue({
      student_id: { firstname: 'Bob', lastname: 'Lee' },
      table_data_string: '[]',
      table_data_string_taiger_guided: '[]',
      analysis: {}
    });
    callApiGateway.mockResolvedValue({ result: {} });
    CourseService.updateCourse.mockResolvedValue({});
    const res = mockRes();

    await processTranscript_api_gatway(
      mockReq({
        params: { studentId, language: 'en' },
        body: { requirementIds: [] }
      }),
      res,
      jest.fn()
    );

    expect(callApiGateway.mock.calls[0][3].factor).toBe(1.5);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards a 500 ErrorResponse to next() when the gateway call throws', async () => {
    CourseService.getCourse.mockResolvedValue({
      student_id: { firstname: 'Ann', lastname: 'Smith' },
      table_data_string: '[]',
      table_data_string_taiger_guided: '[]',
      analysis: {}
    });
    callApiGateway.mockRejectedValue(new Error('apig down'));
    const next = jest.fn();

    await processTranscript_api_gatway(
      mockReq({
        params: { studentId, language: 'en' },
        body: { requirementIds: [], factor: 1.5 }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500 });
  });
});
