import AllcourseDAO from '../dao/allcourse.dao';

/**
 * AllcourseService — business layer for the global course catalogue
 * (Allcourse). Delegates data access to the DAO (controller -> service -> dao).
 */
const AllcourseService = {
  getAllcourses() {
    return AllcourseDAO.getAllcourses();
  },

  getAllcourseById(courseId) {
    return AllcourseDAO.getAllcourseById(courseId);
  },

  deleteAllcourseById(courseId) {
    return AllcourseDAO.deleteAllcourseById(courseId);
  },

  updateAllcourseById(courseId, payload) {
    return AllcourseDAO.updateAllcourseById(courseId, payload);
  },

  createAllcourse(payload) {
    return AllcourseDAO.createAllcourse(payload);
  }
};

module.exports = AllcourseService;
