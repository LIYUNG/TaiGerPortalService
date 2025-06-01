const { isProgramDecided } = require('@taiger-common/core');

const DocumentThreadService = {
  async getThreadById(req, messagesThreadId) {
    return req.db
      .model('Documentthread')
      .findById(messagesThreadId)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference'
      )
      .populate('messages.user_id', 'firstname lastname role')
      .populate('program_id')
      .populate('outsourced_user_id', 'firstname lastname role')
      .lean();
  },
  async getStudentsThreadsByTaiGerUserId(req, userId) {
    const threads = await req.db
      .model('Documentthread')
      .find()
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email'
      )
      .populate({
        path: 'student_id',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('application_id')
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang'
      )
      .lean();
    console.log(threads);
    // TODO: check if application is decided
    const filteredThreads = threads.filter(
      (thread) =>
        (thread.student_id?.agents.some(
          (agent) => agent._id.toString() === userId
        ) ||
          thread.student_id?.editors.some(
            (editor) => editor._id.toString() === userId
          ) ||
          (thread.file_type === 'Essay' &&
            thread.outsourced_user_id?.some(
              (o_user_id) => o_user_id._id.toString() === userId
            ))) &&
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getThreads(req, filter) {
    return req.db
      .model('Documentthread')
      .find(filter)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference'
      )
      .populate('messages.user_id', 'firstname lastname role')
      .populate('program_id')
      .populate('outsourced_user_id', 'firstname lastname role')
      .lean();
  }
};

module.exports = DocumentThreadService;
