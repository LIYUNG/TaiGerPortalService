const mongoose = require('mongoose');
const { Role } = require('@taiger-common/core');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Frontend table column id -> aggregation sort path. Derived fields (nameEn,
// nameZh, agentNames, editorNames) are materialised in STUDENT_DERIVED_STAGES.
const STUDENT_SORT_FIELD_MAP = {
  name_en: 'nameEn',
  name_zh: 'nameZh',
  archiv: 'archiv',
  agentNames: 'agentNames',
  editorNames: 'editorNames',
  attended_university: 'academic_background.university.attended_university',
  attended_university_program:
    'academic_background.university.attended_university_program',
  application_year: 'application_preference.expected_application_date',
  target_degree: 'application_preference.target_degree',
  application_semester: 'application_preference.expected_application_semester',
  // Native Mongoose timestamp on the root document (User has timestamps: true).
  createdAt: 'createdAt'
};

// Frontend table column id -> aggregation path for regex (contains) filters.
const STUDENT_TEXT_FILTERS = {
  name_en: 'nameEn',
  name_zh: 'nameZh',
  agentNames: 'agentNames',
  editorNames: 'editorNames',
  attributesString: 'attributes.name',
  attended_university: 'academic_background.university.attended_university',
  attended_university_program:
    'academic_background.university.attended_university_program',
  application_year: 'application_preference.expected_application_date',
  target_degree: 'application_preference.target_degree',
  application_semester: 'application_preference.expected_application_semester'
};

// Fields a free-text `search` query is matched against (regex, case-insensitive).
const STUDENT_GLOBAL_SEARCH_FIELDS = [
  'nameEn',
  'nameZh',
  'agentNames',
  'editorNames',
  'attributes.name',
  'academic_background.university.attended_university',
  'academic_background.university.attended_university_program',
  'application_preference.expected_application_date',
  'application_preference.target_degree',
  'application_preference.expected_application_semester'
];

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseStudentsQuery = (query = {}) => {
  const { page, limit, search, sortBy, sortOrder } = query;
  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const sortPath = STUDENT_SORT_FIELD_MAP[sortBy] || 'nameEn';
  const sortDir = String(sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const filters = {};
  Object.keys(STUDENT_TEXT_FILTERS).forEach((field) => {
    if (query[field] !== undefined && query[field] !== '') {
      filters[STUDENT_TEXT_FILTERS[field]] = String(query[field]).trim();
    }
  });

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    search: typeof search === 'string' ? search.trim() : '',
    filters,
    // Stable secondary sort on _id so pagination is deterministic.
    sort: { [sortPath]: sortDir, _id: 1 }
  };
};

// Materialise the derived fields the table sorts/filters on: full names and the
// joined agent/editor first-name strings. Agents/editors are arrays of refs, so
// they are looked up and reduced to comma-joined name strings.
const STUDENT_DERIVED_STAGES = [
  {
    $lookup: {
      from: 'users',
      let: { agentIds: { $ifNull: ['$agents', []] } },
      pipeline: [
        { $match: { $expr: { $in: ['$_id', '$$agentIds'] } } },
        { $project: { firstname: 1 } }
      ],
      as: '_agents'
    }
  },
  {
    $lookup: {
      from: 'users',
      let: { editorIds: { $ifNull: ['$editors', []] } },
      pipeline: [
        { $match: { $expr: { $in: ['$_id', '$$editorIds'] } } },
        { $project: { firstname: 1 } }
      ],
      as: '_editors'
    }
  },
  {
    $addFields: {
      nameEn: {
        $trim: {
          input: {
            $concat: [
              { $ifNull: ['$firstname', ''] },
              ' ',
              { $ifNull: ['$lastname', ''] }
            ]
          }
        }
      },
      nameZh: {
        $concat: [
          { $ifNull: ['$lastname_chinese', ''] },
          { $ifNull: ['$firstname_chinese', ''] }
        ]
      },
      agentNames: {
        $reduce: {
          input: { $ifNull: ['$_agents.firstname', []] },
          initialValue: '',
          in: {
            $cond: [
              { $eq: ['$$value', ''] },
              '$$this',
              { $concat: ['$$value', ', ', '$$this'] }
            ]
          }
        }
      },
      editorNames: {
        $reduce: {
          input: { $ifNull: ['$_editors.firstname', []] },
          initialValue: '',
          in: {
            $cond: [
              { $eq: ['$$value', ''] },
              '$$this',
              { $concat: ['$$value', ', ', '$$this'] }
            ]
          }
        }
      }
    }
  }
];

/**
 * StudentService handles queries for the Student model.
 */
const StudentService = {
  /**
   * Fetches a student by ID with optional population.
   *
   * @param {mongoose.Connection} db - The Mongoose connection instance.
   * @param {string} filter - The query filter.
   * @returns {Promise<mongoose.Document | null>} - The student document.
   */
  async fetchStudents(req, filter = {}, options = {}) {
    return req.db
      .model('Student')
      .find(filter)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .select('-notification')
      .select('-notification')
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean();
  },
  async fetchSimpleStudents(req, filter) {
    return req.db
      .model('Student')
      .find(filter)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .select('-notification')
      .lean();
  },

  /**
   * Server-side paginated / sorted / searchable variant of fetchStudents.
   *
   * Strategy (mirrors ApplicationService.getActiveStudentsApplicationsPaginated):
   * a lightweight aggregation materialises the derived fields the table filters
   * on (full names, agent/editor name strings), applies search + column filters
   * + sort, and returns only the page of `_id`s (+ a total via $facet). Then the
   * page is hydrated with the same population chain as fetchStudents, so the
   * returned shape is identical and the heavy payload is bounded to `limit` docs.
   *
   * @param {object} filter base filter (role/archiv/agents/editors) from UserQueryBuilder
   * @param {object} query raw req.query (page, limit, sortBy, sortOrder, search, column filters)
   * @returns {{ students: object[], total: number, page: number, limit: number }}
   */
  async getStudentsPaginated(req, { filter = {}, query = {} }) {
    const { page, limit, skip, search, filters, sort } =
      parseStudentsQuery(query);
    const Student = req.db.model('Student');

    // aggregate() does not auto-apply the discriminator filter, so scope to
    // students explicitly alongside the base filter (archiv/agents/editors).
    const preMatch = { ...filter, role: Role.Student };
    // aggregate() $match (unlike find()) does NOT cast query values, so the
    // agents/editors ObjectId refs arrive as strings and would never match —
    // cast them explicitly.
    ['agents', 'editors'].forEach((key) => {
      if (
        typeof preMatch[key] === 'string' &&
        mongoose.Types.ObjectId.isValid(preMatch[key])
      ) {
        preMatch[key] = new mongoose.Types.ObjectId(preMatch[key]);
      }
    });

    const postMatch = {};
    Object.values(STUDENT_TEXT_FILTERS).forEach((path) => {
      if (typeof filters[path] === 'string') {
        postMatch[path] = { $regex: escapeRegex(filters[path]), $options: 'i' };
      }
    });
    if (search) {
      const pattern = escapeRegex(search);
      postMatch.$or = STUDENT_GLOBAL_SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: pattern, $options: 'i' }
      }));
    }

    const pipeline = [
      { $match: preMatch },
      ...STUDENT_DERIVED_STAGES,
      ...(Object.keys(postMatch).length > 0 ? [{ $match: postMatch }] : []),
      {
        $facet: {
          rows: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            { $project: { _id: 1 } }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ];

    const [aggResult] = await Student.aggregate(pipeline).allowDiskUse(true);
    const ids = (aggResult?.rows ?? []).map((row) => row._id);
    const total = aggResult?.total?.[0]?.count ?? 0;

    if (ids.length === 0) {
      return { students: [], total, page, limit };
    }

    const docs = await Student.find({ _id: { $in: ids } })
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .select('-notification')
      .lean();

    // $in does not preserve the aggregation's sort order — restore it.
    const orderMap = new Map(ids.map((id, index) => [id.toString(), index]));
    docs.sort(
      (a, b) => orderMap.get(a._id.toString()) - orderMap.get(b._id.toString())
    );

    return { students: docs, total, page, limit };
  },
  async getStudents(req, { filter = {}, options = {} }) {
    return req.db
      .model('User')
      .find(filter)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean();
  },
  async getStudentById(req, id) {
    return req.db
      .model('Student')
      .findById(id)
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .lean();
  },
  async updateStudentById(req, id, update) {
    return req.db
      .model('Student')
      .findByIdAndUpdate(id, update, { new: true })
      .populate('agents editors', 'firstname lastname email archiv pictureUrl')
      .lean();
  },
  async getStudentsWithApplications(req, filter) {
    const students = await req.db.model('Student').aggregate([
      {
        $match: filter
      },
      {
        $lookup: {
          from: 'applications',
          localField: '_id',
          foreignField: 'studentId',
          as: 'applications'
        }
      },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'courses'
        }
      },
      {
        $addFields: {
          courses: { $arrayElemAt: ['$courses', 0] }
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { agentIds: '$agents' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$agentIds'] }
              }
            },
            {
              $project: {
                firstname: 1,
                lastname: 1,
                email: 1,
                archiv: 1
              }
            }
          ],
          as: 'agents'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { editorIds: '$editors' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$editorIds'] }
              }
            },
            {
              $project: {
                firstname: 1,
                lastname: 1,
                email: 1,
                archiv: 1
              }
            }
          ],
          as: 'editors'
        }
      },
      {
        $unwind: {
          path: '$generaldocs_threads',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'documentthreads',
          localField: 'generaldocs_threads.doc_thread_id',
          foreignField: '_id',
          as: 'generaldocs_threads.doc_thread_id'
        }
      },
      {
        $addFields: {
          'generaldocs_threads.doc_thread_id': {
            $arrayElemAt: ['$generaldocs_threads.doc_thread_id', 0]
          }
        }
      },
      {
        $group: {
          _id: '$_id',
          generaldocs_threads: { $push: '$generaldocs_threads' },
          applications: { $first: '$applications' },
          agents: { $first: '$agents' },
          editors: { $first: '$editors' },
          courses: { $first: '$courses' },
          root: { $first: '$$ROOT' }
        }
      },
      {
        $addFields: {
          generaldocs_threads: {
            $filter: {
              input: '$generaldocs_threads',
              as: 'thread',
              cond: { $ne: ['$$thread', {}] }
            }
          }
        }
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              '$root',
              {
                generaldocs_threads: '$generaldocs_threads',
                applications: '$applications',
                agents: '$agents',
                editors: '$editors',
                courses: '$courses'
              }
            ]
          }
        }
      },
      {
        $addFields: {
          hasApplications: { $gt: [{ $size: '$applications' }, 0] }
        }
      },
      {
        $facet: {
          withApplications: [
            { $match: { hasApplications: true } },
            { $unwind: '$applications' },
            {
              $lookup: {
                from: 'programs',
                localField: 'applications.programId',
                foreignField: '_id',
                as: 'applications.program'
              }
            },
            {
              $addFields: {
                'applications.programId': {
                  $arrayElemAt: ['$applications.program', 0]
                }
              }
            },
            {
              $group: {
                _id: '$_id',
                applications: { $push: '$applications' },
                agents: { $first: '$agents' },
                editors: { $first: '$editors' },
                generaldocs_threads: { $first: '$generaldocs_threads' },
                root: { $first: '$$ROOT' }
              }
            },
            {
              $replaceRoot: {
                newRoot: {
                  $mergeObjects: [
                    '$root',
                    {
                      applications: '$applications',
                      agents: '$agents',
                      editors: '$editors',
                      generaldocs_threads: '$generaldocs_threads'
                    }
                  ]
                }
              }
            }
          ],
          withoutApplications: [{ $match: { hasApplications: false } }]
        }
      },
      {
        $project: {
          result: {
            $concatArrays: ['$withApplications', '$withoutApplications']
          }
        }
      },
      {
        $unwind: '$result'
      },
      {
        $replaceRoot: { newRoot: '$result' }
      }
    ]);
    return students;
  }
};

module.exports = StudentService;
