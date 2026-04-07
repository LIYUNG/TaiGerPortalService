const InterviewService = {
  async getInterviews(req, filter) {
    return req.db
      .model('Interview')
      .find(filter)
      .populate('trainer_id', 'firstname lastname email pictureUrl')
      .populate('event_id')
      .lean();
  },
  async getInterviewById(req, id) {
    return req.db
      .model('Interview')
      .findById(id)
      .populate('trainer_id', 'firstname lastname email pictureUrl')
      .populate('event_id')
      .lean();
  },
  async getInterviewsByStudentId(req, studentId) {
    return req.db
      .model('Interview')
      .find({ student_id: studentId })
      .populate('trainer_id', 'firstname lastname email pictureUrl')
      .populate('event_id')
      .lean();
  }
};

module.exports = InterviewService;
