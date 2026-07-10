import { FilterQuery, UpdateQuery, Types, SortOrder, Model } from 'mongoose';
import { ICommunication } from '@taiger-common/model';
import { Communication as CommunicationModel } from '../models';

// `Communication` is compiled via the generic `compile()` helper in
// models/index.ts, which loses the schema's document generic (falls back to
// `Model<any>`). Re-assert the real document type here so query results
// (e.g. lean `createdAt`) type-check against `ICommunication`.
const Communication = CommunicationModel as unknown as Model<ICommunication>;

const POPULATE: [string, string] = [
  'student_id user_id readBy ignoredMessageBy',
  'firstname lastname role pictureUrl'
];

// Escape regex metacharacters so a user's query is matched literally (also
// guards against invalid-regex crashes / ReDoS from attacker input).
const escapeRegex = (value: string) =>
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
  async getCommunicationByStudentId(studentId: string) {
    return Communication.find({ studentId }).lean();
  },

  async getCommunicationById(communicationId: string) {
    return Communication.findById(communicationId)
      .populate(...POPULATE)
      .lean();
  },

  async getCommunications(query: FilterQuery<ICommunication>) {
    return Communication.find(query)
      .populate(...POPULATE)
      .lean();
  },

  // Communications matching `filter`, author populated, newest-first, capped —
  // for the AI-assist conversation context.
  async findPopulatedSorted(
    filter: FilterQuery<ICommunication>,
    {
      sort = { createdAt: -1 },
      limit
    }: { sort?: Record<string, SortOrder>; limit?: number } = {}
  ) {
    const query = Communication.find(filter)
      .populate('user_id', 'firstname lastname role')
      .sort(sort)
      .limit(limit as number);
    return query.lean();
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
  async getByStudentIdForExport(studentId: string) {
    return Communication.find({ student_id: studentId })
      .populate(
        'student_id user_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors'
      )
      .lean();
  },

  // Most-recent messages for a student (newest first), lightly populated — used
  // by the TaiGer AI chat assistant for conversation context.
  async getRecentByStudentId(studentId: string, limit: number) {
    return Communication.find({ student_id: studentId })
      .populate('student_id user_id', 'firstname lastname role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  async createCommunication(payload: Partial<ICommunication>) {
    return Communication.create(payload);
  },

  async deleteById(communicationId: string) {
    return Communication.findByIdAndDelete(communicationId);
  },

  // Newest message for a student (lean) — unread badge for students.
  async getLatestByStudentId(studentId: string) {
    return Communication.findOne({ student_id: studentId })
      .sort({ createdAt: -1 })
      .lean();
  },

  // Latest message timestamp per student across many students, in one
  // aggregation. Used by the AI-assist portfolio overview to detect
  // communication gaps (students who have gone silent) without N queries.
  // `studentIds` should be ObjectId instances. Returns
  // [{ _id: <studentObjectId>, latestAt: <Date> }].
  async getLatestMessageAtForStudents(studentIds: Types.ObjectId[]) {
    if (!studentIds || !studentIds.length) {
      return [];
    }
    return Communication.aggregate([
      { $match: { student_id: { $in: studentIds } } },
      { $group: { _id: '$student_id', latestAt: { $max: '$createdAt' } } }
    ]);
  },

  // Students whose latest message was sent by themselves (not the team) and
  // not marked as "no reply needed" (ignore_message != true). One aggregation:
  // sort desc, group to get latest, filter where sender == student.
  // Returns [{ _id: <studentObjectId>, latestAt: <Date> }].
  async getUnansweredStudentMessages(studentIds: Types.ObjectId[]) {
    if (!studentIds?.length) return [];
    return Communication.aggregate([
      { $match: { student_id: { $in: studentIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$student_id',
          latestUserId: { $first: '$user_id' },
          latestIgnore: { $first: '$ignore_message' },
          latestAt: { $first: '$createdAt' }
        }
      },
      {
        $match: {
          $expr: { $eq: ['$latestUserId', '$_id'] },
          latestIgnore: { $ne: true }
        }
      },
      { $project: { _id: 1, latestAt: 1 } }
    ]);
  },

  // A student's chat thread, newest-first, with the given populate spec.
  // Returns live documents unless `lean` is set (callers that mark-as-read
  // mutate + .save() the returned docs).
  async findThreadPopulated(
    studentId: string,
    {
      populate,
      select,
      skip = 0,
      limit,
      lean = false
    }: {
      populate?: string;
      select?: string;
      skip?: number;
      limit?: number;
      lean?: boolean;
    } = {}
  ) {
    let query = Communication.find({ student_id: studentId }).sort({
      createdAt: -1
    });
    query = query.populate(populate as string, select);
    if (skip) {
      query = query.skip(skip);
    }
    if (limit) {
      query = query.limit(limit);
    }
    return lean ? query.lean() : query;
  },

  async updateCommunication(
    communicationId: string,
    payload: UpdateQuery<ICommunication>
  ) {
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
  async searchThread(
    studentId: string,
    q: string,
    { limit = 50 }: { limit?: number } = {}
  ) {
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
  async getThreadContext(
    studentId: string,
    messageId: string,
    { before = 5, after = 5 }: { before?: number; after?: number } = {}
  ) {
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
  async getAdjacentMessages(
    studentId: string,
    messageId: string,
    direction: string,
    limit = 5
  ) {
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
