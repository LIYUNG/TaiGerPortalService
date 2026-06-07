const { User } = require('../models');

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

  async getUserByEmail(email) {
    return User.findOne({ email }).lean();
  }
};

module.exports = UserDAO;
