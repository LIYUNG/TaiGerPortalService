import { UpdateQuery } from 'mongoose';
import { IAllCourse } from '@taiger-common/model';
import { Allcourse } from '../models';

const UPDATED_BY_POPULATE: [string, string] = [
  'updatedBy',
  'firstname lastname pictureUrl'
];

/**
 * AllcourseDAO — data access for the Allcourse model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const AllcourseDAO = {
  async getAllcourses() {
    return Allcourse.find()
      .populate(...UPDATED_BY_POPULATE)
      .lean();
  },

  async getAllcourseById(courseId: string) {
    return Allcourse.findById(courseId).populate(...UPDATED_BY_POPULATE);
  },

  async deleteAllcourseById(courseId: string) {
    return Allcourse.findByIdAndDelete(courseId);
  },

  async updateAllcourseById(
    courseId: string,
    payload: UpdateQuery<IAllCourse>
  ) {
    return Allcourse.findByIdAndUpdate(courseId, payload, {
      new: true,
      runValidators: true
    }).populate(...UPDATED_BY_POPULATE);
  },

  async createAllcourse(payload: Partial<IAllCourse>) {
    return Allcourse.create(payload);
  }
};

export = AllcourseDAO;
