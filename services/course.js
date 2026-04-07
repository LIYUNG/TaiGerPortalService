const CourseService = {
  async getCourse(req, filter) {
    return req.db
      .model('Course')
      .findOne(filter)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese email role academic_background archiv pictureUrl application_preference'
      )
      .lean();
  },
  async updateCourse(req, filter, update) {
    return req.db
      .model('Course')
      .findOneAndUpdate(filter, update, { new: true })
      .lean();
  },
  async deleteCourse(req, filter) {
    return req.db.model('Course').findOneAndDelete(filter).lean();
  },
  async createCourse(req, data) {
    return req.db.model('Course').create(data);
  },
  async getCourseById(req, id) {
    return req.db.model('Course').findById(id).lean();
  }
};

module.exports = CourseService;
