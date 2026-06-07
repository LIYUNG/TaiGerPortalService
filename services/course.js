const CourseDAO = require('../dao/course.dao');

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

module.exports = CourseService;
