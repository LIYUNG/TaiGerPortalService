const InterviewService = {
  async getInterviewById(req, id) {
    return req.db
      .model('Interview')
      .findById(id)
      .populate('trainer_id', 'firstname lastname email')
      .populate('event_id')
      .lean();
  },
  async getInterviewsByStudentId(req, studentId) {
    return req.db
      .model('Interview')
      .find({ student_id: studentId })
      .populate('trainer_id', 'firstname lastname email')
      .populate('event_id')
      .lean();
  }
};

module.exports = InterviewService;
