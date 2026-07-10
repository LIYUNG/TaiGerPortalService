// CourseService is a thin business layer over CourseDAO. This is a UNIT test:
// the DAO is mocked so no database (in-memory or otherwise) is touched. Every
// method delegates verbatim, so we assert the DAO is called with the exact args
// and the service returns the DAO result.
jest.mock('../../dao/course.dao');

import CourseDAOReal from '../../dao/course.dao';
import CourseService from '../../services/course';

const CourseDAO = CourseDAOReal as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CourseService (mocked DAO)', () => {
  it('getCourse delegates to DAO with filter', async () => {
    const filter = { student_id: 's1' };
    const daoResult = { _id: 'c1' };
    CourseDAO.getCourse.mockResolvedValue(daoResult);

    const result = await CourseService.getCourse(filter);

    expect(CourseDAO.getCourse).toHaveBeenCalledTimes(1);
    expect(CourseDAO.getCourse).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('updateCourse delegates to DAO with filter and update', async () => {
    const filter = { student_id: 's1' };
    const update = { table_data_string_locked: true };
    const daoResult = { _id: 'c1' };
    CourseDAO.updateCourse.mockResolvedValue(daoResult);

    const result = await CourseService.updateCourse(filter, update);

    expect(CourseDAO.updateCourse).toHaveBeenCalledTimes(1);
    expect(CourseDAO.updateCourse).toHaveBeenCalledWith(filter, update);
    expect(result).toBe(daoResult);
  });

  it('upsertCourseByStudentId delegates to DAO with studentId and fields', async () => {
    const fields = { table_data_string: '{}' };
    const daoResult = { _id: 'c1', student_id: 's1' };
    CourseDAO.upsertCourseByStudentId.mockResolvedValue(daoResult);

    const result = await CourseService.upsertCourseByStudentId('s1', fields);

    expect(CourseDAO.upsertCourseByStudentId).toHaveBeenCalledTimes(1);
    expect(CourseDAO.upsertCourseByStudentId).toHaveBeenCalledWith(
      's1',
      fields
    );
    expect(result).toBe(daoResult);
  });

  it('deleteCourse delegates to DAO with filter', async () => {
    const filter = { _id: 'c1' };
    const daoResult = { deletedCount: 1 };
    CourseDAO.deleteCourse.mockResolvedValue(daoResult);

    const result = await CourseService.deleteCourse(filter);

    expect(CourseDAO.deleteCourse).toHaveBeenCalledTimes(1);
    expect(CourseDAO.deleteCourse).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('createCourse delegates to DAO with data', async () => {
    const data = { student_id: 's1', table_data_string: '{}' };
    const daoResult = { _id: 'c1' };
    CourseDAO.createCourse.mockResolvedValue(daoResult);

    const result = await CourseService.createCourse(data as any);

    expect(CourseDAO.createCourse).toHaveBeenCalledTimes(1);
    expect(CourseDAO.createCourse).toHaveBeenCalledWith(data);
    expect(result).toBe(daoResult);
  });

  it('getCourseById delegates to DAO with id', async () => {
    const daoResult = { _id: 'c1' };
    CourseDAO.getCourseById.mockResolvedValue(daoResult);

    const result = await CourseService.getCourseById('c1');

    expect(CourseDAO.getCourseById).toHaveBeenCalledTimes(1);
    expect(CourseDAO.getCourseById).toHaveBeenCalledWith('c1');
    expect(result).toBe(daoResult);
  });
});
