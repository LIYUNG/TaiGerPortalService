import { Communication } from '../models';

const POPULATE = [
  'student_id user_id readBy ignoredMessageBy',
  'firstname lastname role pictureUrl'
];

/**
 * CommunicationDAO — data access for the Communication model (central
 * default-connection model). Plain params, no req.
 */
const CommunicationDAO = {
  async getCommunicationByStudentId(studentId) {
    return Communication.find({ studentId }).lean();
  },

  async getCommunicationById(communicationId) {
    return Communication.findById(communicationId)
      .populate(...POPULATE)
      .lean();
  },

  async getCommunications(query) {
    return Communication.find(query)
      .populate(...POPULATE)
      .lean();
  },

  // Communications matching `filter`, author populated, newest-first, capped —
  // for the AI-assist conversation context.
  async findPopulatedSorted(filter, { sort = { createdAt: -1 }, limit } = {}) {
    return Communication.find(filter)
      .populate('user_id', 'firstname lastname role')
      .sort(sort)
      .limit(limit)
      .lean();
  },

  // All communications with student + author lightly populated — for the
  // response-interval grouping job.
  async getAllForIntervalGrouping() {
    return Communication.find()
      .populate('student_id user_id', 'firstname lastname email archiv')
      .lean();
  },

  // Full thread for a student, populated with the names/roles needed by the PDF
  // export (newest-first ordering is applied by the caller).
  async getByStudentIdForExport(studentId) {
    return Communication.find({ student_id: studentId })
      .populate(
        'student_id user_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors'
      )
      .lean();
  },

  // Most-recent messages for a student (newest first), lightly populated — used
  // by the TaiGer AI chat assistant for conversation context.
  async getRecentByStudentId(studentId, limit) {
    return Communication.find({ student_id: studentId })
      .populate('student_id user_id', 'firstname lastname role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  async createCommunication(payload) {
    return Communication.create(payload);
  },

  async deleteById(communicationId) {
    return Communication.findByIdAndDelete(communicationId);
  },

  // Newest message for a student (lean) — unread badge for students.
  async getLatestByStudentId(studentId) {
    return Communication.findOne({ student_id: studentId })
      .sort({ createdAt: -1 })
      .lean();
  },

  // A student's chat thread, newest-first, with the given populate spec.
  // Returns live documents unless `lean` is set (callers that mark-as-read
  // mutate + .save() the returned docs).
  async findThreadPopulated(
    studentId,
    { populate, select, skip = 0, limit, lean = false } = {}
  ) {
    let query = Communication.find({ student_id: studentId })
      .populate(populate, select)
      .sort({ createdAt: -1 });
    if (skip) {
      query = query.skip(skip);
    }
    if (limit) {
      query = query.limit(limit);
    }
    return lean ? query.lean() : query;
  },

  async updateCommunication(communicationId, payload) {
    return Communication.findByIdAndUpdate(communicationId, payload, {
      new: true
    })
      .populate(...POPULATE)
      .lean();
  }
};

export = CommunicationDAO;
