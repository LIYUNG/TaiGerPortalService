import mongoose, { FilterQuery, UpdateQuery } from 'mongoose';
import { IInterview } from '@taiger-common/model';
import { Interview } from '../models';

// `query` is intentionally `any`: these builders return the query so the caller
// can `.lean()` it, and the DAO methods below deliberately expose that loose
// result to (still-untyped) controllers. Typing it as a concrete mongoose
// `Query` would propagate a strict `FlattenMaps` lean type into those callers
// and break them — so the loose builder seam stays `any` until the controllers
// are typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withPopulate = (query: any) =>
  query
    .populate('trainer_id', 'firstname lastname email pictureUrl')
    .populate('event_id')
    .lean();

// Apply a list of populate argument tuples (e.g. [['program_id', 'school']]).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyPopulates = (query: any, populates: unknown[][] = []) =>
  populates.reduce((populated, args) => populated.populate(...args), query);

// ── Server-side pagination helpers ───────────────────────────────────────────
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Map the field names the frontend table sends -> the field/path the aggregation
// pipeline can sort on. Joined fields live under `student`/`program`; the
// computed status/duplicate/survey/event-start live at the top level.
const SORT_FIELD_MAP: Record<string, string> = {
  status: 'status',
  isDuplicate: 'isDuplicate',
  surveySubmitted: 'surveySubmitted',
  firstname_lastname: 'student.firstname',
  start: 'eventStart',
  interview_date: 'interview_date',
  program_name: 'program.school'
};

// Regex (contains, case-insensitive) filters that match an $or across several
// joined paths. Each is sent as a single query param.
const STUDENT_NAME_FILTER_KEY = 'studentName';
const STUDENT_NAME_PATHS = ['student.firstname', 'student.lastname'];
const TRAINER_NAME_FILTER_KEY = 'trainerName';
const TRAINER_NAME_PATHS = ['trainer.firstname', 'trainer.lastname'];
const PROGRAM_NAME_FILTER_KEY = 'program';
const PROGRAM_NAME_PATHS = ['program.school', 'program.program_name'];
// Agent (顧問/consultant) is linked on the STUDENT (student.agents), not on the
// interview — so we join the student's agents and filter on their names.
const AGENT_NAME_FILTER_KEY = 'agentName';
const AGENT_NAME_PATHS = ['agent.firstname', 'agent.lastname'];

// Fields a free-text `search` query is matched against (regex, case-insensitive).
const GLOBAL_SEARCH_FIELDS = [
  'student.firstname',
  'student.lastname',
  'program.school',
  'program.program_name',
  'program.degree',
  'program.semester',
  'trainer.firstname',
  'trainer.lastname',
  'agent.firstname',
  'agent.lastname'
];

const escapeRegex = (value: unknown) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Cast a 24-hex string to an ObjectId. Mongoose `.find()` auto-casts via the
// schema, but `Model.aggregate()` does NOT — so a string id in a $match would
// never match the ObjectId-typed field.
const toObjectId = (value: unknown) => {
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
};

// Cast a value, an array, or each value inside an operator object (e.g.
// { $in: [...] }, { $ne: id }, { $size: 0 }) — recursing so nested ids are cast
// while non-id values (numbers, etc.) pass through untouched.
const castFilterValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(castFilterValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(value).forEach((op) => {
      out[op] = castFilterValue((value as Record<string, unknown>)[op]);
    });
    return out;
  }
  return toObjectId(value);
};

// Object-id-typed fields on the Interview document whose string values need
// casting before an aggregation $match.
const OBJECT_ID_FILTER_FIELDS = [
  '_id',
  'student_id',
  'trainer_id',
  'program_id',
  'event_id',
  'thread_id'
];

// Normalise a base scope filter for an aggregation $match: cast ObjectId-typed
// fields from strings and coerce the boolean `isClosed` (which arrives as the
// string 'true'/'false' from the query string). Unlike Mongoose `.find()`,
// aggregation does not auto-cast, so without this a string `student_id` /
// `trainer_id` / `isClosed` silently matches nothing.
const normalizeAggregateFilter = (filter: Record<string, unknown> = {}) => {
  const out: Record<string, unknown> = {};
  Object.keys(filter).forEach((key) => {
    if (OBJECT_ID_FILTER_FIELDS.includes(key)) {
      out[key] = castFilterValue(filter[key]);
    } else if (key === 'isClosed' && typeof filter[key] === 'string') {
      out[key] = (filter[key] as string).toLowerCase() === 'true';
    } else {
      out[key] = filter[key];
    }
  });
  return out;
};

const parseArrayParam = (value: unknown) => {
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

// Parse a 'true'/'false' query value into a boolean, or undefined when absent.
const parseBoolParam = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return value === true || String(value).toLowerCase() === 'true';
};

// Parse an ISO date query value into a Date, or undefined when absent/invalid.
// `endOfDay` pushes a date-only bound to 23:59:59.999 so a "to" filter is
// inclusive of the whole selected day.
const parseDateParam = (value: unknown, endOfDay = false) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
};

// Build a { $gte, $lte } range from optional from/to bounds, or undefined when
// neither is present.
const buildDateRange = (from?: Date, to?: Date) => {
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) {
    range.$gte = from;
  }
  if (to) {
    range.$lte = to;
  }
  return Object.keys(range).length > 0 ? range : undefined;
};

const parseInterviewsQuery = (
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

  const sortPath = SORT_FIELD_MAP[sortBy ?? ''] || 'interview_date';
  const sortDir = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

  const filters: Record<string, unknown> = {};
  const statusValues = parseArrayParam(query.status);
  if (statusValues.length > 0) {
    filters.status = statusValues;
  }
  const isDuplicate = parseBoolParam(query.isDuplicate);
  if (isDuplicate !== undefined) {
    filters.isDuplicate = isDuplicate;
  }
  const surveySubmitted = parseBoolParam(query.surveySubmitted);
  if (surveySubmitted !== undefined) {
    filters.surveySubmitted = surveySubmitted;
  }
  [
    STUDENT_NAME_FILTER_KEY,
    TRAINER_NAME_FILTER_KEY,
    PROGRAM_NAME_FILTER_KEY,
    AGENT_NAME_FILTER_KEY
  ].forEach((key) => {
    if (query[key] !== undefined && query[key] !== '') {
      filters[key] = String(query[key]).trim();
    }
  });

  // Date-range filters: training time (the linked event's start) and the
  // official interview time.
  const trainingTime = buildDateRange(
    parseDateParam(query.trainingTimeFrom),
    parseDateParam(query.trainingTimeTo, true)
  );
  if (trainingTime) {
    filters.trainingTime = trainingTime;
  }
  const interviewTime = buildDateRange(
    parseDateParam(query.interviewTimeFrom),
    parseDateParam(query.interviewTimeTo, true)
  );
  if (interviewTime) {
    filters.interviewTime = interviewTime;
  }

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    search: typeof search === 'string' ? search.trim() : '',
    filters,
    // Stable secondary sort on _id so pagination is deterministic.
    sort: { [sortPath]: sortDir, _id: 1 } as Record<string, 1 | -1>
  };
};

// Populate chain for the hydrated page — produces the same document shape the
// frontend interview table transform consumes.
const PAGINATED_POPULATES = [
  ['student_id trainer_id', 'firstname lastname email'],
  ['program_id', 'school program_name degree semester'],
  ['event_id']
];

// Slim projected row returned by the paginated aggregation's `rows` facet.
interface PaginatedInterviewAggRow {
  _id: mongoose.Types.ObjectId;
  status: string;
  isDuplicate: boolean;
  surveySubmitted: boolean;
  agents?: unknown[];
}

/**
 * InterviewDAO — data access for the Interview model (central default-connection
 * model). Plain params, no req.
 */
const InterviewDAO = {
  async getInterviews(filter: FilterQuery<IInterview>) {
    return withPopulate(Interview.find(filter));
  },

  async getInterviewById(id: string) {
    return withPopulate(Interview.findById(id));
  },

  async getInterviewsByStudentId(studentId: string) {
    return withPopulate(Interview.find({ student_id: studentId }));
  },

  // Live (non-lean) document — used for status pre-checks / delete.
  async findByIdRaw(id: string) {
    return Interview.findById(id);
  },

  async findInterviews(
    filter: FilterQuery<IInterview>,
    populates: unknown[][] = []
  ) {
    return applyPopulates(Interview.find(filter), populates).lean();
  },

  async findInterviewByIdPopulated(id: string, populates: unknown[][] = []) {
    return applyPopulates(Interview.findById(id), populates).lean();
  },

  async findOneInterview(
    filter: FilterQuery<IInterview>,
    populates: unknown[][] = []
  ) {
    return applyPopulates(Interview.findOne(filter), populates).lean();
  },

  // Distinct ids of students who already have a trained (event-bearing)
  // interview among the given candidates.
  async distinctTrainedStudentIds(studentIds: string[]) {
    return Interview.find({
      student_id: { $in: studentIds },
      event_id: { $exists: true, $ne: null }
    }).distinct('student_id');
  },

  async updateInterviewByIdRaw(id: string, payload: UpdateQuery<IInterview>) {
    return Interview.findByIdAndUpdate(id, payload, {});
  },

  async updateInterviewByIdPopulated(
    id: string,
    payload: UpdateQuery<IInterview>,
    populates: unknown[][] = []
  ) {
    return applyPopulates(
      Interview.findByIdAndUpdate(id, payload, { new: true }),
      populates
    ).lean();
  },

  async upsertInterviewPopulated(
    filter: FilterQuery<IInterview>,
    payload: UpdateQuery<IInterview>,
    populates: unknown[][] = []
  ) {
    return applyPopulates(
      Interview.findOneAndUpdate(filter, payload, { upsert: true }),
      populates
    ).lean();
  },

  async deleteInterviewById(id: string) {
    return Interview.findByIdAndDelete(id);
  },

  async aggregateInterviews(pipeline: mongoose.PipelineStage[]) {
    return Interview.aggregate(pipeline);
  },

  // Distinct program ids the student already has an interview for — lets the FE
  // build the "Add interview" program list without loading the full set.
  async studentInterviewProgramIds(studentId: string) {
    const ids = await Interview.find({ student_id: studentId }).distinct(
      'program_id'
    );
    return ids.filter(Boolean).map((id) => id.toString());
  },

  /**
   * Server-side paginated / sorted / searchable interviews.
   *
   * Strategy mirrors getStudentsApplicationsPaginated: a lightweight
   * aggregation joins program/student/trainer/event/survey, materialises the
   * three computed columns (status, isDuplicate, surveySubmitted), applies
   * search/filter/sort and returns only the page of `_id`s (+ total via $facet).
   * Then the page is hydrated with the full populate chain. The computed columns
   * are re-attached from the aggregation so the FE can filter/sort on them.
   *
   * `status` reproduces controllers/interviews.js addInterviewStatus so the
   * status filter/sort match what the table shows.
   *
   * @param {object} filter base scope match ({} for staff, { student_id } for a student)
   * @param {object} query raw req.query (page, limit, sortBy, sortOrder, search, filters)
   * @returns {{ interviews: object[], total: number, page: number, limit: number }}
   */
  async getInterviewsPaginated({
    filter = {},
    query = {}
  }: {
    filter?: FilterQuery<IInterview>;
    query?: Record<string, unknown>;
  }) {
    const { page, limit, skip, search, filters, sort } =
      parseInterviewsQuery(query);
    const now = new Date();

    const andConditions = [];
    if (Array.isArray(filters.status) && filters.status.length > 0) {
      andConditions.push({ status: { $in: filters.status } });
    }
    if (filters.isDuplicate !== undefined) {
      andConditions.push({ isDuplicate: filters.isDuplicate });
    }
    if (filters.surveySubmitted !== undefined) {
      andConditions.push({ surveySubmitted: filters.surveySubmitted });
    }
    [
      { key: STUDENT_NAME_FILTER_KEY, paths: STUDENT_NAME_PATHS },
      { key: TRAINER_NAME_FILTER_KEY, paths: TRAINER_NAME_PATHS },
      { key: PROGRAM_NAME_FILTER_KEY, paths: PROGRAM_NAME_PATHS },
      { key: AGENT_NAME_FILTER_KEY, paths: AGENT_NAME_PATHS }
    ].forEach(({ key, paths }) => {
      if (filters[key]) {
        const pattern = escapeRegex(filters[key]);
        andConditions.push({
          $or: paths.map((path) => ({
            [path]: { $regex: pattern, $options: 'i' }
          }))
        });
      }
    });
    if (search) {
      const pattern = escapeRegex(search);
      andConditions.push({
        $or: GLOBAL_SEARCH_FIELDS.map((field) => ({
          [field]: { $regex: pattern, $options: 'i' }
        }))
      });
    }
    // Date ranges match the materialised eventStart / interview_date. A range
    // naturally excludes interviews with no such date (null), which is the
    // intended behaviour when filtering by a time window.
    if (filters.trainingTime) {
      andConditions.push({ eventStart: filters.trainingTime });
    }
    if (filters.interviewTime) {
      andConditions.push({ interview_date: filters.interviewTime });
    }
    const postMatch = andConditions.length > 0 ? { $and: andConditions } : {};

    const pipeline: mongoose.PipelineStage[] = [
      { $match: normalizeAggregateFilter(filter) },
      {
        $lookup: {
          from: 'programs',
          let: { pid: '$program_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
            {
              $project: {
                school: 1,
                program_name: 1,
                degree: 1,
                semester: 1
              }
            }
          ],
          as: 'program'
        }
      },
      { $unwind: { path: '$program', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          let: { sid: '$student_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$sid'] } } },
            { $project: { firstname: 1, lastname: 1, email: 1, agents: 1 } }
          ],
          as: 'student'
        }
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      {
        // The student's assigned agent(s) (顧問). Used by the agent-name filter
        // and surfaced as a column so an agent can find their own students.
        $lookup: {
          from: 'users',
          let: { aids: { $ifNull: ['$student.agents', []] } },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$aids'] } } },
            { $project: { firstname: 1, lastname: 1, email: 1 } }
          ],
          as: 'agent'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { tids: { $ifNull: ['$trainer_id', []] } },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$tids'] } } },
            { $project: { firstname: 1, lastname: 1, email: 1 } }
          ],
          as: 'trainer'
        }
      },
      {
        $lookup: {
          from: 'events',
          let: { eid: '$event_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$eid'] } } },
            { $project: { start: 1 } }
          ],
          as: 'event'
        }
      },
      { $unwind: { path: '$event', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'interviewsurveyresponses',
          let: { iid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$interview_id', '$$iid'] },
                    { $eq: ['$isFinal', true] }
                  ]
                }
              }
            },
            { $project: { _id: 1 } }
          ],
          as: 'survey'
        }
      },
      {
        $lookup: {
          from: 'interviews',
          let: { sid: '$student_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$student_id', '$$sid'] } } },
            { $project: { event_id: 1 } }
          ],
          as: 'studentInterviews'
        }
      },
      {
        $addFields: {
          surveySubmitted: { $gt: [{ $size: '$survey' }, 0] },
          isDuplicate: { $gt: [{ $size: '$studentInterviews' }, 1] },
          eventStart: '$event.start',
          // Trained = the student has any event-bearing interview (mirrors
          // distinctTrainedStudentIds: event_id exists & not null). Use $type
          // so a missing event_id is not treated as a real id (a missing field
          // is not reliably equal to null in $ne comparisons).
          studentTrained: {
            $anyElementTrue: {
              $map: {
                input: '$studentInterviews',
                as: 'si',
                in: { $eq: [{ $type: '$$si.event_id' }, 'objectId'] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          status: {
            $switch: {
              branches: [
                { case: { $eq: ['$isClosed', true] }, then: 'Closed' },
                {
                  // Only a real interview_date in the past => "Interviewed".
                  // $type guards against a missing date (which is not reliably
                  // != null in $ne and would otherwise sort below `now`).
                  case: {
                    $and: [
                      { $eq: [{ $type: '$interview_date' }, 'date'] },
                      { $lt: ['$interview_date', now] }
                    ]
                  },
                  then: 'Interviewed'
                },
                {
                  // Only a real event start => "Trained"/"Scheduled". Without
                  // the $type guard a missing eventStart slips through and
                  // ($lt: [missing, now]) wrongly yields "Trained".
                  case: { $eq: [{ $type: '$eventStart' }, 'date'] },
                  then: {
                    $cond: [
                      { $lt: ['$eventStart', now] },
                      'Trained',
                      'Scheduled'
                    ]
                  }
                },
                { case: '$studentTrained', then: 'N/A' }
              ],
              default: 'Open'
            }
          }
        }
      },
      ...(Object.keys(postMatch).length > 0 ? [{ $match: postMatch }] : []),
      {
        $facet: {
          rows: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                status: 1,
                isDuplicate: 1,
                surveySubmitted: 1,
                agents: '$agent'
              }
            }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ];

    const [aggResult] = await Interview.aggregate(pipeline).allowDiskUse(true);
    const rows = aggResult?.rows ?? [];
    const total = aggResult?.total?.[0]?.count ?? 0;

    if (rows.length === 0) {
      return { interviews: [], total, page, limit };
    }

    const typedRows = rows as PaginatedInterviewAggRow[];
    const ids = typedRows.map((row) => row._id);
    const computedById = new Map<string, Record<string, unknown>>(
      typedRows.map((row): [string, Record<string, unknown>] => [
        row._id.toString(),
        {
          status: row.status,
          isDuplicate: row.isDuplicate,
          surveySubmitted: row.surveySubmitted,
          agents: row.agents ?? []
        }
      ])
    );

    const docs = (await applyPopulates(
      Interview.find({ _id: { $in: ids } }),
      PAGINATED_POPULATES
    ).lean()) as Array<
      Record<string, unknown> & { _id: mongoose.Types.ObjectId }
    >;

    // Re-attach the computed columns and restore the aggregation sort order
    // ($in does not preserve it).
    const orderMap = new Map<string, number>(
      ids.map((id, index): [string, number] => [id.toString(), index])
    );
    const interviews = docs
      .map((doc) => ({
        ...doc,
        ...(computedById.get(doc._id.toString()) ?? {})
      }))
      .sort(
        (a, b) =>
          orderMap.get(a._id.toString())! - orderMap.get(b._id.toString())!
      );

    return { interviews, total, page, limit };
  }
};

export = InterviewDAO;
