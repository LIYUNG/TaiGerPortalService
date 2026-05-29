const ACTIVE_PROGRAM_FILTER = {
  $or: [{ isArchiv: { $exists: false } }, { isArchiv: false }]
};

const PROGRAM_LIST_FIELDS = [
  '_id',
  'school',
  'program_name',
  'programSubjects',
  'tags',
  'country',
  'degree',
  'semester',
  'lang',
  'toefl',
  'ielts',
  'gre',
  'gmat',
  'application_deadline',
  'updatedAt',
  'isLocked'
].join(' ');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ALLOWED_SORT_FIELDS = new Set([
  'school',
  'program_name',
  'country',
  'degree',
  'semester',
  'updatedAt',
  'application_deadline'
]);

const TEXT_FILTER_FIELDS = [
  'school',
  'program_name',
  'degree',
  'semester',
  'lang',
  'toefl',
  'ielts',
  'gre',
  'gmat',
  'application_deadline'
];

const ARRAY_FILTER_FIELDS = ['country', 'programSubjects', 'tags'];

const GLOBAL_SEARCH_FIELDS = [
  'school',
  'program_name',
  'country',
  'degree',
  'semester',
  'lang',
  'toefl',
  'ielts',
  'gre',
  'gmat',
  'application_deadline'
];

const STALE_PROGRAM_MS = 270 * 24 * 60 * 60 * 1000;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseArrayParam = (value) => {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseProgramsQuery = (query = {}) => {
  const { page, limit, search, sortBy, sortOrder } = query;
  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const normalizedSortBy = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'school';
  const normalizedSortOrder =
    String(sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const filters = {};

  if (query.lockStatus === 'Locked' || query.lockStatus === 'Unlocked') {
    filters.lockStatus = query.lockStatus;
  }

  TEXT_FILTER_FIELDS.forEach((field) => {
    if (query[field]) {
      filters[field] = String(query[field]).trim();
    }
  });

  ARRAY_FILTER_FIELDS.forEach((field) => {
    const values = parseArrayParam(query[field]);
    if (values.length > 0) {
      filters[field] = values;
    }
  });

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    search: typeof search === 'string' ? search.trim() : '',
    filters,
    sort: {
      [normalizedSortBy]: normalizedSortOrder,
      ...(normalizedSortBy !== 'program_name' ? { program_name: 1 } : {})
    }
  };
};

const buildProgramsFilter = ({ search, filters = {} }) => {
  const filter = { ...ACTIVE_PROGRAM_FILTER };
  const andConditions = [];

  if (search) {
    const pattern = escapeRegex(search);
    andConditions.push({
      $or: GLOBAL_SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: pattern, $options: 'i' }
      }))
    });
  }

  TEXT_FILTER_FIELDS.forEach((field) => {
    if (filters[field]) {
      andConditions.push({
        [field]: { $regex: escapeRegex(filters[field]), $options: 'i' }
      });
    }
  });

  ARRAY_FILTER_FIELDS.forEach((field) => {
    if (filters[field]?.length) {
      andConditions.push({ [field]: { $in: filters[field] } });
    }
  });

  if (filters.lockStatus === 'Locked') {
    const staleBefore = new Date(Date.now() - STALE_PROGRAM_MS);
    andConditions.push({
      $or: [
        { updatedAt: { $exists: false } },
        { updatedAt: { $lt: staleBefore } }
      ]
    });
  } else if (filters.lockStatus === 'Unlocked') {
    const staleBefore = new Date(Date.now() - STALE_PROGRAM_MS);
    andConditions.push({ updatedAt: { $gte: staleBefore } });
  }

  if (andConditions.length > 0) {
    filter.$and = andConditions;
  }

  return filter;
};

const ProgramService = {
  parseProgramsQuery,

  async getPrograms(req, filter) {
    return req.db.model('Program').find(filter).lean();
  },

  async getProgramsPaginated(req, query = {}) {
    const { page, limit, skip, search, filters, sort } =
      parseProgramsQuery(query);
    const filter = buildProgramsFilter({ search, filters });
    const Program = req.db.model('Program');

    const [programs, total] = await Promise.all([
      Program.find(filter)
        .select(PROGRAM_LIST_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Program.countDocuments(filter)
    ]);

    return {
      programs,
      total,
      page,
      limit
    };
  },

  async getProgramById(req, programId) {
    return req.db.model('Program').findById(programId).lean();
  }
};

module.exports = ProgramService;
