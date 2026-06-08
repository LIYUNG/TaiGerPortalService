// Controller UNIT test for controllers/allcourses.
//
// The allcourses handlers are plain (req, res, next) functions (wrapped by
// asyncHandler), so we call them DIRECTLY with fake req/res/next and a mocked
// AllcourseService. No route, no middleware, no database. We assert ONLY the
// controller's own work: the args it forwards to the service, the status + body
// it writes (including the 400 validation and 404 not-found branches), and that
// a service error is forwarded to next(). Full-stack wiring lives in
// __tests__/integration/allcourses.test.js.

jest.mock('../../services/allcourses');

const AllcourseService = require('../../services/allcourses');
const {
  getCourses,
  getCourse,
  deleteCourse,
  updateCourse,
  createCourse
} = require('../../controllers/allcourses');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { agent } = require('../mock/user');

const courseId = '012345678901234567891234';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getCourses', () => {
  it('responds 200 with the courses the service resolves', async () => {
    const courses = [{ _id: 'c1', all_course_english: 'math' }];
    AllcourseService.getAllcourses.mockResolvedValue(courses);
    const res = mockRes();

    await getCourses(mockReq(), res, jest.fn());

    expect(AllcourseService.getAllcourses).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: courses });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    AllcourseService.getAllcourses.mockRejectedValue(err);
    const next = jest.fn();

    await getCourses(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getCourse', () => {
  it('200: returns the course and forwards the courseId', async () => {
    const course = { _id: courseId, all_course_english: 'physics' };
    AllcourseService.getAllcourseById.mockResolvedValue(course);
    const res = mockRes();

    await getCourse(mockReq({ params: { courseId } }), res, jest.fn());

    expect(AllcourseService.getAllcourseById).toHaveBeenCalledWith(courseId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: course });
  });

  it('404: responds not found when the service resolves nothing', async () => {
    AllcourseService.getAllcourseById.mockResolvedValue(null);
    const res = mockRes();

    await getCourse(mockReq({ params: { courseId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

describe('createCourse', () => {
  it('201: forwards the body to createAllcourse and returns the created course', async () => {
    const created = { _id: 'c2', all_course_english: 'test' };
    AllcourseService.createAllcourse.mockResolvedValue(created);
    const req = mockReq({
      body: { all_course_chinese: '測試', all_course_english: 'test' }
    });
    const res = mockRes();

    await createCourse(req, res, jest.fn());

    expect(AllcourseService.createAllcourse).toHaveBeenCalledWith(
      expect.objectContaining({
        all_course_chinese: '測試',
        all_course_english: 'test'
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual(created);
  });

  it('400: rejects when a required name is missing (no service call)', async () => {
    const res = mockRes();

    await createCourse(
      mockReq({ body: { all_course_english: 'only english' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(AllcourseService.createAllcourse).not.toHaveBeenCalled();
  });
});

describe('updateCourse', () => {
  it('200: forwards courseId + payload (with updatedBy) and returns the updated course', async () => {
    const updated = { _id: courseId, all_course_english: 'updated' };
    AllcourseService.updateAllcourseById.mockResolvedValue(updated);
    const req = mockReq({
      user: agent,
      params: { courseId },
      body: { all_course_chinese: '測試', all_course_english: 'updated' }
    });
    const res = mockRes();

    await updateCourse(req, res, jest.fn());

    expect(AllcourseService.updateAllcourseById).toHaveBeenCalledWith(
      courseId,
      expect.objectContaining({
        all_course_english: 'updated',
        updatedBy: agent._id
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual(updated);
  });

  it('400: rejects when a required name is missing (no service call)', async () => {
    const res = mockRes();

    await updateCourse(
      mockReq({
        user: agent,
        params: { courseId },
        body: { all_course_english: 'only english' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(AllcourseService.updateAllcourseById).not.toHaveBeenCalled();
  });

  it('404: responds not found when the service resolves nothing', async () => {
    AllcourseService.updateAllcourseById.mockResolvedValue(null);
    const res = mockRes();

    await updateCourse(
      mockReq({
        user: agent,
        params: { courseId },
        body: { all_course_chinese: '測試', all_course_english: 'updated' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('deleteCourse', () => {
  it('200: forwards the courseId and reports success', async () => {
    AllcourseService.deleteAllcourseById.mockResolvedValue({ _id: courseId });
    const res = mockRes();

    await deleteCourse(mockReq({ params: { courseId } }), res, jest.fn());

    expect(AllcourseService.deleteAllcourseById).toHaveBeenCalledWith(courseId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('404: responds not found when the service resolves nothing', async () => {
    AllcourseService.deleteAllcourseById.mockResolvedValue(null);
    const res = mockRes();

    await deleteCourse(mockReq({ params: { courseId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
