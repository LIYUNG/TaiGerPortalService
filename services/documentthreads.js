const StudentService = require('./students');

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
  async getStudentThreadsByStudentId(req, studentId) {
    const threads = await req.db
      .model('Documentthread')
      .find({ student_id: studentId })
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang'
      )
      .populate('student_id', 'firstname lastname')
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname')
      .populate('outsourced_user_id', 'firstname lastname')
      .lean();

    const filteredThreads = threads.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
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
  async getAllStudentsThreads(req, query) {
    const queryFilter = { ...query };
    const activeStudentsIds = await StudentService.fetchSimpleStudents(req, {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    queryFilter.student_id = {
      $in: activeStudentsIds.map((student) => student._id)
    };
    const threads = await req.db
      .model('Documentthread')
      .find(queryFilter)
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

    const filteredThreads = threads.filter(
      (thread) =>
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
  },
  async updateThreadById(req, threadId, payload) {
    return req.db
      .model('Documentthread')
      .findByIdAndUpdate(threadId, payload, { new: true })
      .lean();
  },
  async updateThread(req, filter, payload) {
    return req.db
      .model('Documentthread')
      .findOneAndUpdate(filter, payload, { new: true })
      .lean();
  }
};

module.exports = DocumentThreadService;
