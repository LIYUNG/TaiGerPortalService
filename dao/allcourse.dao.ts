import { Allcourse } from '../models';

const UPDATED_BY_POPULATE = ['updatedBy', 'firstname lastname pictureUrl'];

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

  async getAllcourseById(courseId) {
    return Allcourse.findById(courseId).populate(...UPDATED_BY_POPULATE);
  },

  async deleteAllcourseById(courseId) {
    return Allcourse.findByIdAndDelete(courseId);
  },

  async updateAllcourseById(courseId, payload) {
    return Allcourse.findByIdAndUpdate(courseId, payload, {
      new: true,
      runValidators: true
    }).populate(...UPDATED_BY_POPULATE);
  },

  async createAllcourse(payload) {
    return Allcourse.create(payload);
  }
};

export = AllcourseDAO;
