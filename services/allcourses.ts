import { IAllCourse } from '@taiger-common/model';
import AllcourseDAO from '../dao/allcourse.dao';

/**
 * AllcourseService — business layer for the global course catalogue
 * (Allcourse). Delegates data access to the DAO (controller -> service -> dao).
 */
const AllcourseService = {
  getAllcourses() {
    return AllcourseDAO.getAllcourses();
  },

  getAllcourseById(courseId: string) {
    return AllcourseDAO.getAllcourseById(courseId);
  },

  deleteAllcourseById(courseId: string) {
    return AllcourseDAO.deleteAllcourseById(courseId);
  },

  updateAllcourseById(courseId: string, payload: Partial<IAllCourse>) {
    return AllcourseDAO.updateAllcourseById(courseId, payload);
  },

  createAllcourse(payload: Partial<IAllCourse>) {
    return AllcourseDAO.createAllcourse(payload);
  }
};

export = AllcourseService;
