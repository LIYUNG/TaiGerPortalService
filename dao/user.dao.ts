import { Role } from '@taiger-common/core';
import {
  User,
  Agent,
  Editor,
  Student,
  Guest,
  Documentthread,
  Application,
  Course,
  Communication,
  Complaint,
  Event,
  Interview,
  surveyInput,
  Ticket
} from '../models';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const USER_LIST_FIELDS = [
  '_id',
  'firstname',
  'lastname',
  'firstname_chinese',
  'lastname_chinese',
  'email',
  'pictureUrl',
  'role',
  'lastLoginAt',
  'createdAt',
  'isAccountActivated',
  'archiv'
].join(' ');

const ALLOWED_SORT_FIELDS = new Set([
  'firstname',
  'lastname',
  'email',
  'role',
  'lastLoginAt',
  'createdAt'
]);

const GLOBAL_SEARCH_FIELDS = [
  'firstname',
  'lastname',
  'firstname_chinese',
  'lastname_chinese',
  'email'
];

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseUsersPaginationQuery = ({
  page,
  limit,
  search,
  sortBy,
  sortOrder
} = {}) => {
  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const normalizedSortBy = ALLOWED_SORT_FIELDS.has(sortBy)
    ? sortBy
    : 'lastname';
  const normalizedSortOrder =
    String(sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    search: typeof search === 'string' ? search.trim() : '',
    sort: {
      [normalizedSortBy]: normalizedSortOrder,
      ...(normalizedSortBy !== 'firstname' ? { firstname: 1 } : {})
    }
  };
};

const appendSearchFilter = (filter, search) => {
  if (!search) {
    return filter;
  }

  const pattern = escapeRegex(search);
  const searchCondition = {
    $or: GLOBAL_SEARCH_FIELDS.map((field) => ({
      [field]: { $regex: pattern, $options: 'i' }
    }))
  };

  if (filter.$and) {
    return {
      ...filter,
      $and: [...filter.$and, searchCondition]
    };
  }

  return {
    ...filter,
    $and: [searchCondition]
  };
};

/**
 * UserDAO — data access for the User model (central default-connection model).
 * Plain params, no req. `parseUsersPaginationQuery` is a pure query-shaping
 * helper kept here alongside the queries it feeds.
 */
const UserDAO = {
  parseUsersPaginationQuery,

  async getUserById(userId) {
    return User.findById(userId).lean();
  },

  async getUsers(query) {
    return User.find(query).lean();
  },

  // Batch lookup by ids — used to resolve client-supplied recipient ids into
  // validated user records (so emails are never trusted from the client).
  async findUsersByIds(ids, select) {
    return User.find({ _id: { $in: ids } })
      .select(select)
      .lean();
  },

  async getUsersPaginated({ filter, page, limit, skip, search, sort }) {
    const queryFilter = appendSearchFilter(filter, search);

    const [users, total] = await Promise.all([
      User.find(queryFilter)
        .select(USER_LIST_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(queryFilter)
    ]);

    return { users, total, page, limit };
  },

  async updateUser(userId, payload) {
    return User.findByIdAndUpdate(userId, payload, { new: true }).lean();
  },

  // `officehours` / `timezone` live ONLY on the Agent/Editor discriminator
  // schemas, not the base User schema. Updating through the base model would let
  // strict-mode silently strip them (a no-op write), so we cast against the
  // role's discriminator model — mirroring the legacy `db.model(role)` path.
  async updateOfficehours(userId, role, { officehours, timezone }) {
    const Model = role === Role.Editor ? Editor : Agent;
    return Model.findByIdAndUpdate(
      userId,
      { officehours, timezone },
      { new: true }
    ).lean();
  },

  // Returns a live (non-lean) Mongoose document so callers can keep mutating it
  // (e.g. subdocument profile updates) and call .save(). Discriminator type is
  // preserved, so Student-only paths like `profile` remain available.
  async updateUserDoc(userId, payload, options = { new: true }) {
    return User.findByIdAndUpdate(userId, payload, options);
  },

  async getUserByEmail(email) {
    return User.findOne({ email }).lean();
  },

  async getUserByFilter(filter) {
    return User.findOne(filter).lean();
  },

  // Live (non-lean) document for callers that mutate + .save() (e.g. password
  // reset).
  async getUserDocByFilter(filter) {
    return User.findOne(filter);
  },

  // Guest signups use the Guest discriminator.
  async createGuest(payload) {
    return Guest.create(payload);
  },

  async getUserByIdSelect(userId, select) {
    return User.findById(userId).select(select).lean();
  },

  // Live document including the (normally hidden) password field — for login
  // strategies that call user.verifyPassword().
  async getUserDocWithPasswordByEmail(email) {
    return User.findOne({ email }).select('+password');
  },

  async touchLastLoginByEmail(email) {
    return User.findOneAndUpdate(
      { email },
      { lastLoginAt: new Date() },
      { upsert: false }
    );
  },

  async touchLastLoginById(userId) {
    return User.findByIdAndUpdate(
      userId,
      { lastLoginAt: new Date() },
      { upsert: true }
    );
  },

  // Agent / Editor discriminator lookups (the exact filter is passed through to
  // preserve legacy query semantics). `select` projects the returned fields.
  async findAgents(filter, select) {
    return Agent.find(filter).select(select);
  },

  async findEditors(filter, select) {
    return Editor.find(filter).select(select);
  },

  async findAgentById(agentId, select) {
    return Agent.findById(agentId).select(select);
  },

  // Live (non-lean) documents — callers mutate notification/agent_notification
  // and call .save().
  async getUserDocById(userId) {
    return User.findById(userId);
  },

  async getAgentDocById(agentId) {
    return Agent.findById(agentId);
  },

  // Role-based create: Students use the Student discriminator; every other role
  // is created on the base User model (preserving the legacy behaviour).
  async createUser(role, payload) {
    const Model = role === Role.Student ? Student : User;
    return Model.create(payload);
  },

  // Update with caller-supplied mongoose options (e.g. overwriteDiscriminatorKey).
  async updateUserWithOptions(userId, fields, options) {
    return User.findByIdAndUpdate(userId, fields, options).lean();
  },

  async updateUserArchiv(userId, isArchived) {
    return User.findByIdAndUpdate(
      userId,
      { archiv: isArchived },
      { new: true, strict: false }
    )
      .populate('editors')
      .lean();
  },

  async deleteUserById(userId) {
    return User.findByIdAndDelete(userId);
  },

  // Pull a departing agent/editor out of every student's team arrays.
  async pullStaffFromStudents(userId) {
    return Student.updateMany(
      { $or: [{ agents: userId }, { editors: userId }] },
      { $pull: { agents: userId, editors: userId } },
      { multi: true }
    );
  },

  // Cascade-delete a student/guest and all of their owned documents. (The legacy
  // controller wrapped these in a session that was never attached to the writes,
  // so the effective behaviour is sequential deletes.)
  async deleteStudentCascade(userId) {
    await Documentthread.deleteMany({ student_id: userId });
    await Application.deleteMany({ studentId: userId });
    await Course.deleteMany({ student_id: userId });
    await Communication.deleteMany({ student_id: userId });
    await Complaint.deleteMany({ requester_id: userId });
    await Event.deleteMany({ requester_id: userId });
    await Interview.deleteMany({ student_id: userId });
    await surveyInput.deleteMany({ studentId: userId });
    await Ticket.deleteMany({ requester_id: userId });
    await User.findByIdAndDelete(userId);
  },

  async getUserRoleCounts() {
    const result = await User.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          adminCount: { $sum: { $cond: [{ $eq: ['$role', 'Admin'] }, 1, 0] } },
          agentCount: { $sum: { $cond: [{ $eq: ['$role', 'Agent'] }, 1, 0] } },
          editorCount: {
            $sum: { $cond: [{ $eq: ['$role', 'Editor'] }, 1, 0] }
          },
          studentCount: {
            $sum: { $cond: [{ $eq: ['$role', 'Student'] }, 1, 0] }
          },
          guestCount: { $sum: { $cond: [{ $eq: ['$role', 'Guest'] }, 1, 0] } },
          externalCount: {
            $sum: { $cond: [{ $eq: ['$role', 'External'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          _id: 0,
          totalUsers: 1,
          adminCount: 1,
          agentCount: 1,
          editorCount: 1,
          studentCount: 1,
          guestCount: 1,
          externalCount: 1
        }
      }
    ]);

    return result.length > 0
      ? result[0]
      : {
          totalUsers: 0,
          adminCount: 0,
          agentCount: 0,
          editorCount: 0,
          studentCount: 0,
          guestCount: 0,
          externalCount: 0
        };
  },

  // Student/Users overview aggregations (5 charts), run in parallel.
  async getUsersOverview() {
    const notEmpty = [{ $match: { _id: { $ne: null, $ne: '' } } }];
    const [
      byTargetDegree,
      byApplicationSemester,
      byTargetField,
      byProgramLanguage,
      byUniversityProgram
    ] = await Promise.all([
      Student.aggregate([
        {
          $group: {
            _id: '$application_preference.target_degree',
            count: { $sum: 1 }
          }
        },
        ...notEmpty,
        { $sort: { count: -1 } },
        { $project: { _id: 0, degree: '$_id', count: 1 } }
      ]),
      Student.aggregate([
        {
          $group: {
            _id: '$application_preference.expected_application_semester',
            count: { $sum: 1 }
          }
        },
        ...notEmpty,
        { $sort: { count: -1 } },
        { $project: { _id: 0, semester: '$_id', count: 1 } }
      ]),
      Student.aggregate([
        {
          $group: {
            _id: '$application_preference.target_application_field',
            count: { $sum: 1 }
          }
        },
        ...notEmpty,
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, field: '$_id', count: 1 } }
      ]),
      Student.aggregate([
        {
          $group: {
            _id: '$application_preference.target_program_language',
            count: { $sum: 1 }
          }
        },
        ...notEmpty,
        { $sort: { count: -1 } },
        { $project: { _id: 0, language: '$_id', count: 1 } }
      ]),
      Student.aggregate([
        {
          $addFields: {
            universityNameLower: {
              $toLower: {
                $ifNull: [
                  '$academic_background.university.attended_university',
                  ''
                ]
              }
            }
          }
        },
        { $match: { universityNameLower: { $ne: '' } } },
        {
          $group: {
            _id: '$universityNameLower',
            count: { $sum: 1 },
            originalName: {
              $first: '$academic_background.university.attended_university'
            }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
        { $project: { _id: 0, university: '$originalName', count: 1 } }
      ])
    ]);

    return {
      byTargetDegree,
      byApplicationSemester,
      byTargetField,
      byProgramLanguage,
      byUniversityProgram
    };
  }
};

export = UserDAO;
