import { Communication } from '../models';

const POPULATE = [
  'student_id user_id readBy ignoredMessageBy',
  'firstname lastname role pictureUrl'
];

// Escape regex metacharacters so a user's query is matched literally (also
// guards against invalid-regex crashes / ReDoS from attacker input).
const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Populate/select used by the context + adjacent-page queries — produces the
// same message shape the chat thread renders.
const CTX_POPULATE = 'student_id user_id readBy ignoredMessageBy';
const CTX_SELECT = 'firstname lastname role pictureUrl';

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
  },

  // Search one student's chat history. Messages are stored as EditorJS JSON
  // strings, so the visible text lives inside the `message` field — a
  // case-insensitive regex on it matches what the user reads. Returns matches
  // newest-first with the author populated, plus the total match count.
  async searchThread(studentId, q, { limit = 50 } = {}) {
    const filter = {
      student_id: studentId,
      message: { $regex: escapeRegex(q), $options: 'i' }
    };
    const [messages, total] = await Promise.all([
      Communication.find(filter)
        .populate('user_id', 'firstname lastname role pictureUrl')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Communication.countDocuments(filter)
    ]);
    return { messages, total };
  },

  // A window of messages centered on `messageId` (Instagram "jump to message"):
  // `before` older + the target + `after` newer, returned oldest-first (the
  // thread display order). `hasOlder`/`hasNewer` tell the client whether more
  // exists beyond the window. Returns null when the message isn't in the thread.
  async getThreadContext(studentId, messageId, { before = 5, after = 5 } = {}) {
    const target = await Communication.findOne({
      _id: messageId,
      student_id: studentId
    })
      .populate(CTX_POPULATE, CTX_SELECT)
      .lean();
    if (!target) {
      return null;
    }

    const [olderDesc, newerAsc] = await Promise.all([
      Communication.find({
        student_id: studentId,
        createdAt: { $lt: target.createdAt }
      })
        .populate(CTX_POPULATE, CTX_SELECT)
        .sort({ createdAt: -1 })
        .limit(before)
        .lean(),
      Communication.find({
        student_id: studentId,
        createdAt: { $gt: target.createdAt }
      })
        .populate(CTX_POPULATE, CTX_SELECT)
        .sort({ createdAt: 1 })
        .limit(after)
        .lean()
    ]);

    return {
      messages: [...olderDesc.reverse(), target, ...newerAsc],
      hasOlder: olderDesc.length === before,
      hasNewer: newerAsc.length === after,
      targetId: messageId
    };
  },

  // A chunk of messages immediately before/after a cursor message (Messenger-
  // style scroll-up / scroll-down from a jumped-to position). `before` returns
  // older messages oldest-first (to prepend); `after` returns newer messages
  // oldest-first (to append). `hasMore` signals whether the chunk hit the limit.
  async getAdjacentMessages(studentId, messageId, direction, limit = 5) {
    const anchor = await Communication.findOne({
      _id: messageId,
      student_id: studentId
    })
      .select('createdAt')
      .lean();
    if (!anchor) {
      return { messages: [], hasMore: false };
    }

    const isBefore = direction === 'before';
    const docs = await Communication.find({
      student_id: studentId,
      createdAt: isBefore
        ? { $lt: anchor.createdAt }
        : { $gt: anchor.createdAt }
    })
      .populate(CTX_POPULATE, CTX_SELECT)
      .sort({ createdAt: isBefore ? -1 : 1 })
      .limit(limit)
      .lean();

    return {
      messages: isBefore ? docs.reverse() : docs,
      hasMore: docs.length === limit
    };
  }
};

export = CommunicationDAO;
