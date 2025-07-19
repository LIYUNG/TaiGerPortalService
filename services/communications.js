const CommunicationService = {
  async getCommunicationByStudentId(req, studentId) {
    return req.db.model('Communication').find({ studentId }).lean();
  },
  async getCommunicationById(req, communicationId) {
    return req.db
      .model('Communication')
      .findById(communicationId)
      .populate(
        'student_id user_id readBy ignoredMessageBy',
        'firstname lastname role'
      )
      .lean();
  },
  async updateCommunication(req, communicationId, payload) {
    return req.db
      .model('Communication')
      .findByIdAndUpdate(communicationId, payload, { new: true })
      .populate(
        'student_id user_id readBy ignoredMessageBy',
        'firstname lastname role'
      )
      .lean();
  }
};

module.exports = CommunicationService;
