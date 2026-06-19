import { FilterQuery, UpdateQuery } from 'mongoose';
import { ICourse } from '@taiger-common/model';
import CourseDAO from '../dao/course.dao';

/**
 * CourseService — business layer for courses. Delegates data access to the DAO
 * (controller -> service -> dao).
 */
const CourseService = {
  getCourse(filter: FilterQuery<ICourse>) {
    return CourseDAO.getCourse(filter);
  },

  updateCourse(filter: FilterQuery<ICourse>, update: UpdateQuery<ICourse>) {
    return CourseDAO.updateCourse(filter, update);
  },

  upsertCourseByStudentId(studentId: string, fields: UpdateQuery<ICourse>) {
    return CourseDAO.upsertCourseByStudentId(studentId, fields);
  },

  deleteCourse(filter: FilterQuery<ICourse>) {
    return CourseDAO.deleteCourse(filter);
  },

  createCourse(data: Partial<ICourse>) {
    return CourseDAO.createCourse(data);
  },

  getCourseById(id: string) {
    return CourseDAO.getCourseById(id);
  }
};

export = CourseService;
