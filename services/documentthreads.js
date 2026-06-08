const StudentService = require('./students');
const DocumentthreadDAO = require('../dao/documentthread.dao');
const { Student, Application, Documentthread } = require('../models');
const {
  createApplicationThreadV2
} = require('../utils/modelHelper/versionControl');

const DocumentThreadService = {
  // Default-connection helpers (no req) used by the migrated application flow.
  newThread(payload) {
    return DocumentthreadDAO.newThread(payload);
  },
  countThreads(filter) {
    return DocumentthreadDAO.countThreads(filter);
  },
  createThread(payload) {
    return DocumentthreadDAO.createThread(payload);
  },
  deleteThreadById(id) {
    return DocumentthreadDAO.deleteThreadById(id);
  },
  updateThreadFields(id, payload) {
    return DocumentthreadDAO.updateThreadFields(id, payload);
  },
  getThreadByIdLean(id) {
    return DocumentthreadDAO.getThreadByIdLean(id);
  },
  findThreads(filter, select) {
    return DocumentthreadDAO.findThreads(filter, select);
  },
  findThreadsSelectSorted(filter, select, sort) {
    return DocumentthreadDAO.findThreadsSelectSorted(filter, select, sort);
  },
  getThreadDocById(id) {
    return DocumentthreadDAO.getThreadDocById(id);
  },
  getThreadDocByIdPopulated(id, populates) {
    return DocumentthreadDAO.getThreadDocByIdPopulated(id, populates);
  },
  findThreadByIdPopulated(id, populates) {
    return DocumentthreadDAO.findThreadByIdPopulated(id, populates);
  },
  findOneThreadPopulated(filter, populates) {
    return DocumentthreadDAO.findOneThreadPopulated(filter, populates);
  },
  findOneThreadDoc(filter) {
    return DocumentthreadDAO.findOneThreadDoc(filter);
  },
  clearAllOutsourcedUsers() {
    return DocumentthreadDAO.clearAllOutsourcedUsers();
  },
  setMessageIgnore(messageId, ignoreMessageState) {
    return DocumentthreadDAO.setMessageIgnore(messageId, ignoreMessageState);
  },
  // Wraps the version-control thread-creation helper with the central
  // default-connection models (no req).
  createApplicationThread(studentId, applicationId, documentCategory) {
    return createApplicationThreadV2(
      {
        StudentModel: Student,
        ApplicationModel: Application,
        DocumentthreadModel: Documentthread
      },
      studentId,
      applicationId,
      documentCategory
    );
  },

  async getThreadById(messagesThreadId) {
    const thread = await Documentthread.findById(messagesThreadId)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference pictureUrl'
      )
      .populate('messages.user_id', 'firstname lastname role archiv pictureUrl')
      .populate('program_id')
      .populate(
        'outsourced_user_id',
        'firstname lastname role archiv pictureUrl'
      )
      .lean();

    return thread;
  },
  async getStudentThreadsByStudentId(studentId) {
    const threads = await Documentthread.find({ student_id: studentId })
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang country updatedAt'
      )
      .populate('student_id', 'firstname lastname pictureUrl')
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname role pictureUrl')
      .populate('outsourced_user_id', 'firstname lastname role pictureUrl')
      .lean();

    const filteredThreads = threads.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getStudentsThreadsByTaiGerUserId(userId, documentThreadFilter = {}) {
    const threads = await Documentthread.find(documentThreadFilter)
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email pictureUrl'
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
        'school program_name application_deadline degree semester lang application_start country updatedAt'
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
        thread.file_type !== 'Interview' &&
        (thread.student_id?.archiv === false ||
          thread.student_id?.archiv === undefined)
    );

    return filteredThreads;
  },
  async getAllStudentsThreads(query) {
    const queryFilter = { ...query };
    const activeStudentsIds = await StudentService.fetchSimpleStudents({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    queryFilter.student_id = {
      $in: activeStudentsIds.map((student) => student._id)
    };
    const threads = await Documentthread.find(queryFilter)
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email pictureUrl'
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
        'school program_name application_deadline degree semester essay_difficulty lang country updatedAt'
      )
      .lean();

    const filteredThreads = threads.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },

  // Active document-thread reads delegate to the DAO, which owns the
  // aggregation pipeline; these stay thin so the service is DB-free.
  async getActiveThreadsPaginated(params) {
    return DocumentthreadDAO.findActiveThreadsPaginated(params);
  },

  async getActiveThreadsCounts(params) {
    return DocumentthreadDAO.countActiveThreads(params);
  },

  async getThreads(filter) {
    const threads = await Documentthread.find(filter)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference pictureUrl'
      )
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname role pictureUrl')
      .populate('program_id')
      .populate('outsourced_user_id', 'firstname lastname role pictureUrl')
      .lean();

    return threads;
  },
  async updateThreadById(threadId, payload) {
    return Documentthread.findByIdAndUpdate(threadId, payload, {
      new: true
    }).lean();
  },
  async updateThread(filter, payload) {
    return Documentthread.findOneAndUpdate(filter, payload, {
      new: true
    }).lean();
  }
};

module.exports = DocumentThreadService;
