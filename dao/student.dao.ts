import mongoose, {
  FilterQuery,
  PipelineStage,
  SortOrder,
  UpdateQuery
} from 'mongoose';
import { Role } from '@taiger-common/core';
import { IStudent } from '@taiger-common/model';

import { Student, User } from '../models';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Frontend table column id -> aggregation sort path. Derived fields (nameEn,
// nameZh, agentNames, editorNames) are materialised in STUDENT_DERIVED_STAGES.
const STUDENT_SORT_FIELD_MAP: Record<string, string> = {
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
const STUDENT_TEXT_FILTERS: Record<string, string> = {
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

const escapeRegex = (value: unknown) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Shared population specs reused across the read/update methods so the
// projected agent/editor fields (and the thread population) stay consistent.
// Spread into .populate(path, select).
const TEAM_POPULATE: [string, string] = [
  'agents editors',
  'firstname lastname email archiv pictureUrl'
];
const GENERALDOCS_THREADS_POPULATE: [string, string] = [
  'generaldocs_threads.doc_thread_id',
  '-messages'
];

// Reduce an array of agent/editor first names (e.g. `$_agents.firstname`) to a
// single ", "-joined string. Used to materialise agentNames / editorNames.
const joinFirstNames = (firstnamesPath: string) => ({
  $reduce: {
    input: { $ifNull: [firstnamesPath, []] },
    initialValue: '',
    in: {
      $cond: [
        { $eq: ['$$value', ''] },
        '$$this',
        { $concat: ['$$value', ', ', '$$this'] }
      ]
    }
  }
});

const parseStudentsQuery = (
  query: {
    page?: string;
    limit?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
    [key: string]: unknown;
  } = {}
) => {
  const { page, limit, search, sortBy, sortOrder } = query;
  const parsedPage = parseInt(page ?? '', 10);
  const parsedLimit = parseInt(limit ?? '', 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const sortPath = (sortBy && STUDENT_SORT_FIELD_MAP[sortBy]) || 'nameEn';
  const sortDir = String(sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const filters: Record<string, string> = {};
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
const STUDENT_DERIVED_STAGES: PipelineStage[] = [
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
      agentNames: joinFirstNames('$_agents.firstname'),
      editorNames: joinFirstNames('$_editors.firstname')
    }
  }
];

/**
 * StudentDAO — data-access layer for the Student model. Uses the central
 * default-connection models (see models/index.js); takes plain params, no req.
 */
const StudentDAO = {
  async fetchStudents(
    filter: FilterQuery<IStudent> = {},
    options: {
      sort?: Record<string, unknown>;
      skip?: number;
      limit?: number;
    } = {}
  ) {
    return Student.find(filter)
      .populate(...TEAM_POPULATE)
      .populate(...GENERALDOCS_THREADS_POPULATE)
      .select('-notification')
      .sort((options.sort ?? {}) as Record<string, SortOrder>)
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 0)
      .lean();
  },

  async fetchSimpleStudents(filter: FilterQuery<IStudent>) {
    return Student.find(filter)
      .populate(...TEAM_POPULATE)
      .select('-notification')
      .lean();
  },

  /**
   * Lean id-only lookup for callers that just need the matching student ids
   * (e.g. scoping thread queries to active students). Skips the team populate
   * and full document payload that `fetchSimpleStudents` carries.
   * @param {object} filter
   * @returns {Promise<Array<{ _id: import('mongoose').Types.ObjectId }>>}
   */
  async fetchStudentIds(filter: FilterQuery<IStudent>) {
    return Student.find(filter).select('_id').lean();
  },

  /**
   * Server-side paginated / sorted / searchable variant of fetchStudents.
   * @param {object} filter base filter (role/archiv/agents/editors) from UserQueryBuilder
   * @param {object} query raw req.query (page, limit, sortBy, sortOrder, search, column filters)
   * @returns {{ students: object[], total: number, page: number, limit: number }}
   */
  async getStudentsPaginated({
    filter = {},
    query = {}
  }: {
    filter?: FilterQuery<IStudent>;
    query?: Record<string, unknown>;
  }) {
    const { page, limit, skip, search, filters, sort } =
      parseStudentsQuery(query);

    // aggregate() does not auto-apply the discriminator filter, so scope to
    // students explicitly alongside the base filter (archiv/agents/editors).
    const preMatch: Record<string, unknown> = { ...filter, role: Role.Student };
    // aggregate() $match (unlike find()) does NOT cast query values, so the
    // agents/editors ObjectId refs arrive as strings and would never match —
    // cast them explicitly.
    ['agents', 'editors'].forEach((key) => {
      const value = preMatch[key];
      if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
        preMatch[key] = new mongoose.Types.ObjectId(value);
      }
    });

    const postMatch: Record<string, unknown> = {};
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

    const pipeline: PipelineStage[] = [
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
          ] as PipelineStage.FacetPipelineStage[],
          total: [{ $count: 'count' }] as PipelineStage.FacetPipelineStage[]
        }
      }
    ];

    const [aggResult] = await Student.aggregate(pipeline).allowDiskUse(true);
    const ids = (aggResult?.rows ?? []).map((row: any) => row._id);
    const total = aggResult?.total?.[0]?.count ?? 0;

    if (ids.length === 0) {
      return { students: [], total, page, limit };
    }

    const docs = await Student.find({ _id: { $in: ids } })
      .populate(...TEAM_POPULATE)
      .populate(...GENERALDOCS_THREADS_POPULATE)
      .select('-notification')
      .lean();

    // $in does not preserve the aggregation's sort order — restore it.
    const orderMap = new Map<string, number>(
      ids.map((id: any, index: number): [string, number] => [
        id.toString(),
        index
      ])
    );
    docs.sort(
      (a: any, b: any) =>
        (orderMap.get(a._id.toString()) ?? 0) -
        (orderMap.get(b._id.toString()) ?? 0)
    );

    return { students: docs, total, page, limit };
  },

  async getStudents({
    filter = {},
    options = {}
  }: {
    filter?: FilterQuery<IStudent>;
    options?: {
      sort?: Record<string, unknown>;
      skip?: number;
      limit?: number;
    };
  }) {
    return User.find(filter)
      .populate(...TEAM_POPULATE)
      .sort((options.sort ?? {}) as Record<string, SortOrder>)
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 0)
      .lean();
  },

  async getStudentById(id: string) {
    return Student.findById(id)
      .populate(...TEAM_POPULATE)
      .populate(...GENERALDOCS_THREADS_POPULATE)
      .lean();
  },

  // Bare lookup (no population) — used where only scalar student fields and the
  // raw agents/editors id arrays are needed.
  async getStudentByIdLean(id: string) {
    return Student.findById(id).lean();
  },

  // Live (non-lean) Student document — caller mutates generaldocs_threads /
  // notification and calls .save().
  async getStudentDocById(id: string) {
    return Student.findById(id);
  },

  // Generic id lookups with a caller-supplied list of populate argument tuples
  // (e.g. [['agents editors', 'firstname lastname email'], ['applications.programId']]).
  async getStudentByIdPopulated(id: string, populates: unknown[][] = []) {
    let query = Student.findById(id);
    populates.forEach((args) => {
      query = query.populate(...(args as [string, string?]));
    });
    return query.lean();
  },

  // Same as above but returns a LIVE document (caller mutates profile/notification
  // and calls .save()).
  async getStudentDocByIdPopulated(id: string, populates: unknown[][] = []) {
    let query = Student.findById(id);
    populates.forEach((args) => {
      query = query.populate(...(args as [string, string?]));
    });
    return query;
  },

  // Positional applications update (findOneAndUpdate with the
  // 'applications.$' positional operator in `filter`), returning the new doc.
  async updateStudentByFilter(
    filter: FilterQuery<IStudent>,
    update: UpdateQuery<IStudent>
  ) {
    return Student.findOneAndUpdate(filter, update, { new: true });
  },

  // Raw id update (no populate; result usually unused).
  async updateStudentByIdRaw(id: string, update: UpdateQuery<IStudent>) {
    return Student.findByIdAndUpdate(id, update, {});
  },

  // Bare query (no population) for arbitrary student filters.
  async findStudents(filter: FilterQuery<IStudent> = {}) {
    return Student.find(filter).lean();
  },

  // Students matching `filter` with only the supervising team names populated —
  // used by the archived-students view.
  async findStudentsWithTeamNames(filter: FilterQuery<IStudent> = {}) {
    return Student.find(filter)
      .populate('agents editors', 'firstname lastname')
      .lean();
  },

  async countStudents(filter: FilterQuery<IStudent> = {}) {
    return Student.find(filter).countDocuments();
  },

  // Student's applications projected to {programId, doc_thread ids} for the
  // response-interval report.
  async getStudentApplicationsForIntervals(studentId: string) {
    return Student.findById(studentId)
      .populate({
        path: 'applications.programId',
        select: 'school program_name'
      })
      .select({
        'applications.programId': 1,
        'applications.doc_modification_thread.doc_thread_id': 1
      })
      .lean();
  },

  async getStudentByIdSelect(id: string, select: string) {
    return Student.findById(id).select(select).lean();
  },

  // Student by id with selected fields + a populate spec (live doc) — the chat
  // header in the communications controller.
  async getStudentByIdSelectPopulated(
    id: string,
    select: string,
    populate: string,
    populateSelect: string
  ) {
    return Student.findById(id)
      .select(select)
      .populate(populate, populateSelect);
  },

  // Full-text student search ranked by textScore, capped — chat user search.
  async searchStudentsByText(
    filter: FilterQuery<IStudent>,
    select: string,
    limit = 10
  ) {
    return Student.find(filter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .select(select)
      .lean();
  },

  // Every student with only their newest communication attached — chat search
  // result enrichment.
  async getStudentsWithLatestCommunication() {
    return Student.aggregate([
      {
        $lookup: {
          from: 'communications',
          let: { studentId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$student_id', '$$studentId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'communications'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          role: 1,
          latestCommunication: { $arrayElemAt: ['$communications', 0] }
        }
      }
    ]);
  },

  // Students (within `studentIds`) whose newest message is unread by `userId`.
  async getUnreadCommunicationStudents(studentIds: string[], userId: string) {
    return Student.aggregate([
      {
        $lookup: {
          from: 'communications',
          let: { studentId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$student_id', '$$studentId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'communications'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          firstname_chinese: 1,
          lastname_chinese: 1,
          role: 1,
          latestCommunication: { $arrayElemAt: ['$communications', 0] }
        }
      },
      {
        $match: {
          'latestCommunication.student_id': { $in: studentIds },
          'latestCommunication.readBy': { $nin: [userId] }
        }
      }
    ]);
  },

  // Students (within `studentIds`) with their newest message, newest-first —
  // the chat inbox list.
  async getStudentsWithLatestCommunicationSorted(studentIds: string[]) {
    return Student.aggregate([
      {
        $lookup: {
          from: 'communications',
          let: { studentId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$student_id', '$$studentId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'communications'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          firstname_chinese: 1,
          lastname_chinese: 1,
          pictureUrl: 1,
          role: 1,
          attributes: 1,
          latestCommunication: { $arrayElemAt: ['$communications', 0] }
        }
      },
      { $match: { 'latestCommunication.student_id': { $in: studentIds } } },
      { $sort: { 'latestCommunication.createdAt': -1 } }
    ]);
  },

  // Active students with their courses joined — feeds the course-selection
  // reminder.
  async getStudentsWithCourses() {
    return Student.aggregate([
      { $match: { archiv: { $ne: true } } },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'courses'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          email: 1,
          role: 1,
          archiv: 1,
          academic_background: 1,
          courses: 1
        }
      }
    ]);
  },

  // Active students with courses + supervising agents resolved — for the agent
  // course-selection reminder.
  async getStudentsWithCoursesAndAgents() {
    return Student.aggregate([
      { $match: { archiv: { $ne: true } } },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'courses'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'agents',
          foreignField: '_id',
          as: 'agentsInfo'
        }
      },
      {
        $project: {
          firstname: 1,
          lastname: 1,
          email: 1,
          role: 1,
          archiv: 1,
          agents: {
            $map: {
              input: '$agents',
              as: 'agentId',
              in: {
                $let: {
                  vars: {
                    agentInfo: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$agentsInfo',
                            cond: { $eq: ['$$this._id', '$$agentId'] }
                          }
                        },
                        0
                      ]
                    }
                  },
                  in: {
                    firstname: '$$agentInfo.firstname',
                    lastname: '$$agentInfo.lastname',
                    archiv: '$$agentInfo.archiv',
                    email: '$$agentInfo.email'
                  }
                }
              }
            }
          },
          academic_background: 1,
          courses: 1
        }
      }
    ]);
  },

  // Students (matching `filter`) with team + general-doc threads and their
  // messages/authors fully populated — for the document-thread interval job.
  async getStudentsForDocumentThreadIntervals(filter: FilterQuery<IStudent>) {
    return Student.find(filter)
      .populate('agents editors', 'firstname lastname email')
      .populate({
        path: 'generaldocs_threads.doc_thread_id',
        populate: {
          path: 'messages',
          populate: { path: 'user_id', model: 'User' }
        }
      })
      .lean();
  },

  // Filtered student lookup returning only `select` fields, capped at `limit` —
  // used by the AI-assist student picker.
  async findStudentsSelect(
    filter: FilterQuery<IStudent> = {},
    select = '',
    limit: number | undefined = undefined
  ) {
    const query = Student.find(filter).select(select).lean();
    if (limit !== undefined) {
      query.limit(limit);
    }
    return query;
  },

  // TaiGer staff (Admin/Agent/Editor) with their expenses joined — feeds the
  // expenses overview.
  async getTaigerUsersWithExpenses() {
    return Student.aggregate([
      { $match: { role: { $in: [Role.Admin, Role.Agent, Role.Editor] } } },
      {
        $lookup: {
          from: 'expenses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'expenses'
        }
      }
    ]);
  },

  // All users with their expenses joined (no role filter).
  async getStudentsWithExpenses() {
    return Student.aggregate([
      {
        $lookup: {
          from: 'expenses',
          localField: '_id',
          foreignField: 'student_id',
          as: 'expenses'
        }
      }
    ]);
  },

  // Students matching `filter`, populated for the per-staff expenses view.
  async getStudentsForExpenses(filter: FilterQuery<IStudent>) {
    return Student.find(filter)
      .populate('agents editors', 'firstname lastname email')
      .populate('generaldocs_threads.doc_thread_id', '-messages')
      .select('-notification')
      .lean();
  },

  // Lookup with only the supervising agents populated (firstname/lastname/email/
  // pictureUrl) — used by course-update notifications.
  async getStudentByIdWithAgents(id: string) {
    return Student.findById(id)
      .populate('agents', 'firstname lastname email pictureUrl')
      .lean();
  },

  // Lookup with both supervising agents and editors populated (incl. archiv) —
  // used by complaint-ticket notifications.
  async getStudentByIdWithTeam(id: string) {
    return Student.findById(id)
      .populate('editors agents', 'firstname lastname email archiv pictureUrl')
      .lean();
  },

  // Lookup with team + general-doc threads (and their latest message files)
  // populated, minus the heavy taigerai field — used by the student detail page.
  async getStudentByIdWithDocThreads(id: string) {
    return Student.findById(id)
      .populate('agents editors', 'firstname lastname email pictureUrl')
      .populate({
        path: 'generaldocs_threads.doc_thread_id',
        select: 'file_type isFinalVersion updatedAt messages.file',
        populate: {
          path: 'messages.user_id',
          select: 'firstname lastname pictureUrl'
        }
      })
      .select('-taigerai')
      .lean();
  },

  async updateStudentById(id: string, update: UpdateQuery<IStudent>) {
    return Student.findByIdAndUpdate(id, update, { new: true })
      .populate(...TEAM_POPULATE)
      .lean();
  },

  async getStudentsWithApplications(filter: FilterQuery<IStudent>) {
    const students = await Student.aggregate([
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

export = StudentDAO;
