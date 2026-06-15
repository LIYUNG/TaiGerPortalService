import CourseDAO from '../dao/course.dao';

/**
 * CourseService — business layer for courses. Delegates data access to the DAO
 * (controller -> service -> dao).
 */
const CourseService = {
  getCourse(filter) {
    return CourseDAO.getCourse(filter);
  },

  updateCourse(filter, update) {
    return CourseDAO.updateCourse(filter, update);
  },

  upsertCourseByStudentId(studentId, fields) {
    return CourseDAO.upsertCourseByStudentId(studentId, fields);
  },

  deleteCourse(filter) {
    return CourseDAO.deleteCourse(filter);
  },

  createCourse(data) {
    return CourseDAO.createCourse(data);
  },

  getCourseById(id) {
    return CourseDAO.getCourseById(id);
  }
};

export = CourseService;
