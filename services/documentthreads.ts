import StudentService from './students';
import DocumentthreadDAO from '../dao/documentthread.dao';

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
  // Delegates the version-control thread-creation helper to the DAO (which owns
  // the model wiring).
  createApplicationThread(studentId, applicationId, documentCategory) {
    return DocumentthreadDAO.createApplicationThread(
      studentId,
      applicationId,
      documentCategory
    );
  },

  async getThreadById(messagesThreadId) {
    return DocumentthreadDAO.findThreadByIdFullyPopulated(messagesThreadId);
  },
  async getStudentThreadsByStudentId(studentId) {
    const threads = await DocumentthreadDAO.findThreadsByStudentIdPopulated(
      studentId
    );

    const filteredThreads = threads.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getStudentsThreadsByTaiGerUserId(userId, documentThreadFilter = {}) {
    const threads = await DocumentthreadDAO.findThreadsForTaiGerUserPopulated(
      documentThreadFilter
    );

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
    const threads = await DocumentthreadDAO.findAllStudentsThreadsPopulated(
      queryFilter
    );

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
    return DocumentthreadDAO.findThreadsPopulated(filter);
  },
  async updateThreadById(threadId, payload) {
    return DocumentthreadDAO.updateThreadByIdReturnNew(threadId, payload);
  },
  async updateThread(filter, payload) {
    return DocumentthreadDAO.updateOneThreadReturnNew(filter, payload);
  }
};

export = DocumentThreadService;
