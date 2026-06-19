import { FilterQuery, UpdateQuery } from 'mongoose';
import { ICourse } from '@taiger-common/model';
import { Course } from '../models';

/**
 * CourseDAO — data access for the Course model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const CourseDAO = {
  async getCourse(filter: FilterQuery<ICourse>) {
    return Course.findOne(filter)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese email role academic_background archiv pictureUrl application_preference'
      )
      .lean();
  },

  async updateCourse(
    filter: FilterQuery<ICourse>,
    update: UpdateQuery<ICourse>
  ) {
    return Course.findOneAndUpdate(filter, update, { new: true }).lean();
  },

  // Upsert a student's course row, returning the pre-update document (new:false)
  // with student_id populated — mirrors the legacy putMycourses behaviour.
  async upsertCourseByStudentId(
    studentId: string,
    fields: UpdateQuery<ICourse>
  ) {
    return Course.findOneAndUpdate({ student_id: studentId }, fields, {
      upsert: true,
      new: false
    }).populate('student_id', 'firstname lastname pictureUrl');
  },

  async deleteCourse(filter: FilterQuery<ICourse>) {
    return Course.findOneAndDelete(filter).lean();
  },

  async createCourse(data: Partial<ICourse>) {
    return Course.create(data);
  },

  async getCourseById(id: string) {
    return Course.findById(id).lean();
  }
};

export = CourseDAO;
