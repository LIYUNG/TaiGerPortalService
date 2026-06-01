const mongoose = require('mongoose');
const { ErrorResponse } = require('../common/errors');
const logger = require('./logger');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Map the field names the frontend table sends -> the field/path the
// aggregation pipeline can sort on. Joined fields live under `prog`/`student`,
// the computed deadline lives under `deadlineDate`.
const SORT_FIELD_MAP = {
  program_name: 'prog.program_name',
  school: 'prog.school',
  semester: 'prog.semester',
  degree: 'prog.degree',
  country: 'prog.country',
  application_year: 'application_year',
  target_year: 'application_year',
  deadline: 'deadlineDate',
  deadlineDate: 'deadlineDate',
  firstname_lastname: 'student.firstname',
  decided: 'decided',
  closed: 'closed',
  admission: 'admission'
};

// Fields a free-text `search` query is matched against (regex, case-insensitive).
const GLOBAL_SEARCH_FIELDS = [
  'prog.program_name',
  'prog.school',
  'prog.country',
  'prog.degree',
  'prog.semester',
  'prog.application_deadline',
  'student.firstname',
  'student.lastname',
  'application_year'
];

// Exact-match filters that live directly on the Application document.
const APPLICATION_EXACT_FILTERS = [
  'decided',
  'closed',
  'admission',
  'application_year'
];

// $in (multi-select) filters that live on the joined program. Comma-separated
// in the query string, mirroring the programs list endpoint.
// (Per-field text filters for school/program_name/degree are intentionally
// omitted: the global `search` already covers those fields.)
const PROGRAM_ARRAY_FILTERS = {
  country: 'prog.country'
};

// Regex (contains, case-insensitive) free-text filters on the joined program.
const PROGRAM_TEXT_FILTERS = {
  semester: 'prog.semester'
};

// Regex (contains, case-insensitive) filter matching the student's first OR
// last name. Sent as a single `studentName` query param.
const STUDENT_NAME_FILTER_KEY = 'studentName';
const STUDENT_NAME_PATHS = ['student.firstname', 'student.lastname'];

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

const parseActiveApplicationsQuery = (query = {}) => {
  const { page, limit, search, sortBy, sortOrder } = query;
  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const sortPath = SORT_FIELD_MAP[sortBy] || 'deadlineDate';
  const sortDir = String(sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const filters = {};
  APPLICATION_EXACT_FILTERS.forEach((field) => {
    if (query[field] !== undefined && query[field] !== '') {
      filters[field] = String(query[field]).trim();
    }
  });
  Object.keys(PROGRAM_ARRAY_FILTERS).forEach((field) => {
    const values = parseArrayParam(query[field]);
    if (values.length > 0) {
      filters[PROGRAM_ARRAY_FILTERS[field]] = values;
    }
  });
  Object.keys(PROGRAM_TEXT_FILTERS).forEach((field) => {
    if (query[field] !== undefined && query[field] !== '') {
      filters[PROGRAM_TEXT_FILTERS[field]] = String(query[field]).trim();
    }
  });
  if (
    query[STUDENT_NAME_FILTER_KEY] !== undefined &&
    query[STUDENT_NAME_FILTER_KEY] !== ''
  ) {
    filters[STUDENT_NAME_FILTER_KEY] = String(
      query[STUDENT_NAME_FILTER_KEY]
    ).trim();
  }

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

// The application -> deadline date is derived (not stored): it combines the
// application's `application_year` (String) with the program's
// `application_deadline` ("MM-DD" or "rolling") and `semester` ("WS"/"SS"),
// mirroring application_deadline_V2_calculator on the frontend. These stages
// materialise a real Date (`deadlineDate`, null for rolling/no-data) so it can
// be sorted and range-filtered at the DB.
const DEADLINE_DATE_STAGES = [
  {
    $addFields: {
      _appYearInt: {
        $convert: {
          input: '$application_year',
          to: 'int',
          onError: null,
          onNull: null
        }
      },
      // Coerce to string defensively: application_deadline is a String in
      // production, but guard against null / Date / other types so the
      // pipeline never throws inside $regexMatch / $split.
      _dl: {
        $cond: [
          { $eq: [{ $type: '$prog.application_deadline' }, 'string'] },
          '$prog.application_deadline',
          ''
        ]
      }
    }
  },
  {
    $addFields: {
      _isRolling: {
        $regexMatch: { input: '$_dl', regex: 'rolling', options: 'i' }
      },
      _dlParts: { $split: ['$_dl', '-'] }
    }
  },
  {
    $addFields: {
      _dlMonth: {
        $cond: [
          { $gte: [{ $size: '$_dlParts' }, 2] },
          {
            $convert: {
              input: { $arrayElemAt: ['$_dlParts', 0] },
              to: 'int',
              onError: null,
              onNull: null
            }
          },
          null
        ]
      },
      _dlDay: {
        $cond: [
          { $gte: [{ $size: '$_dlParts' }, 2] },
          {
            $convert: {
              input: { $arrayElemAt: ['$_dlParts', 1] },
              to: 'int',
              onError: null,
              onNull: null
            }
          },
          null
        ]
      }
    }
  },
  {
    $addFields: {
      _dlYear: {
        $switch: {
          branches: [
            {
              case: {
                $and: [
                  { $eq: ['$prog.semester', 'WS'] },
                  { $gt: ['$_dlMonth', 9] }
                ]
              },
              then: { $subtract: ['$_appYearInt', 1] }
            },
            {
              case: {
                $and: [
                  { $eq: ['$prog.semester', 'SS'] },
                  { $gt: ['$_dlMonth', 3] }
                ]
              },
              then: { $subtract: ['$_appYearInt', 1] }
            }
          ],
          default: '$_appYearInt'
        }
      }
    }
  },
  {
    $addFields: {
      deadlineDate: {
        $cond: [
          {
            $or: [
              '$_isRolling',
              { $eq: ['$_appYearInt', null] },
              { $eq: ['$_dlMonth', null] },
              { $eq: ['$_dlDay', null] },
              { $lt: ['$_dlMonth', 1] },
              { $gt: ['$_dlMonth', 12] },
              { $lt: ['$_dlDay', 1] },
              { $gt: ['$_dlDay', 31] }
            ]
          },
          null,
          {
            $dateFromParts: {
              year: '$_dlYear',
              month: '$_dlMonth',
              day: '$_dlDay'
            }
          }
        ]
      }
    }
  }
];

// Shared population chain so the paginated and non-paginated endpoints return
// the exact same document shape (consumed by programs_refactor_v2 on the FE).
const populateActiveApplications = (query) =>
  query
    .populate({
      path: 'studentId',
      populate: {
        path: 'editors agents',
        select: 'firstname lastname email pictureUrl'
      }
    })
    .populate({
      path: 'studentId',
      populate: {
        path: 'generaldocs_threads.doc_thread_id',
        select: '-messages'
      }
    })
    .populate(
      'programId',
      'school program_name degree semester lang country uni_assist application_deadline application_start whoupdated updatedAt'
    )
    .populate('doc_modification_thread.doc_thread_id', '-messages');

const ApplicationService = {
  async createApplication(req) {
    const { studentId } = req.params;
    const { programId } = req.body;
    const application = await req.db.model('Application').create({
      studentId,
      programId
    });
    return application;
  },
  async getActiveStudentsApplications(req, { filter = {}, options = {} }) {
    const applications = await populateActiveApplications(
      req.db.model('Application').find(filter)
    ).lean();

    return applications;
  },

  /**
   * Server-side paginated / sorted / searchable variant of
   * getActiveStudentsApplications.
   *
   * Strategy: run a lightweight aggregation that joins program + student,
   * computes the derived `deadlineDate`, applies search/filter/sort and returns
   * only the page of `_id`s (+ a total count via $facet). Then hydrate just that
   * page with the full population chain. This keeps the heavy populated payload
   * bounded to `limit` documents — which is what fixes the data-transfer
   * throttling — while still allowing sort/search across joined fields.
   *
   * @param {string[]} studentIds active (non-archived) student ids to scope to
   * @param {object} query raw req.query (page, limit, sortBy, sortOrder, search, filters)
   * @returns {{ applications: object[], total: number, page: number, limit: number }}
   */
  async getActiveStudentsApplicationsPaginated(
    req,
    { studentIds = [], query = {} }
  ) {
    const { page, limit, skip, search, filters, sort } =
      parseActiveApplicationsQuery(query);
    const Application = req.db.model('Application');

    if (studentIds.length === 0) {
      return { applications: [], total: 0, page, limit };
    }

    const objectIds = studentIds.map(
      (id) => new mongoose.Types.ObjectId(id.toString())
    );

    // Application-level exact filters can be applied before the lookups (cheap,
    // shrinks the working set as early as possible).
    const preMatch = { studentId: { $in: objectIds } };
    APPLICATION_EXACT_FILTERS.forEach((field) => {
      if (filters[field] !== undefined) {
        preMatch[field] = filters[field];
      }
    });

    // Filters / search that touch joined program/student fields run after the
    // lookups. Collected as $and conditions so multiple $or-groups (student name
    // + global search) don't clobber each other.
    const andConditions = [];
    Object.values(PROGRAM_ARRAY_FILTERS).forEach((path) => {
      if (Array.isArray(filters[path]) && filters[path].length > 0) {
        andConditions.push({ [path]: { $in: filters[path] } });
      }
    });
    Object.values(PROGRAM_TEXT_FILTERS).forEach((path) => {
      if (typeof filters[path] === 'string') {
        andConditions.push({
          [path]: { $regex: escapeRegex(filters[path]), $options: 'i' }
        });
      }
    });
    if (filters[STUDENT_NAME_FILTER_KEY]) {
      const pattern = escapeRegex(filters[STUDENT_NAME_FILTER_KEY]);
      andConditions.push({
        $or: STUDENT_NAME_PATHS.map((path) => ({
          [path]: { $regex: pattern, $options: 'i' }
        }))
      });
    }
    if (search) {
      const pattern = escapeRegex(search);
      andConditions.push({
        $or: GLOBAL_SEARCH_FIELDS.map((field) => ({
          [field]: { $regex: pattern, $options: 'i' }
        }))
      });
    }
    const postMatch = andConditions.length > 0 ? { $and: andConditions } : {};

    const pipeline = [
      { $match: preMatch },
      {
        $lookup: {
          from: 'programs',
          let: { pid: '$programId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
            {
              $project: {
                program_name: 1,
                school: 1,
                semester: 1,
                degree: 1,
                country: 1,
                application_deadline: 1
              }
            }
          ],
          as: 'prog'
        }
      },
      { $unwind: { path: '$prog', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'users',
          let: { sid: '$studentId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$sid'] } } },
            { $project: { firstname: 1, lastname: 1 } }
          ],
          as: 'student'
        }
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
      ...DEADLINE_DATE_STAGES,
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

    const [aggResult] = await Application.aggregate(pipeline).allowDiskUse(
      true
    );
    const ids = (aggResult?.rows ?? []).map((row) => row._id);
    const total = aggResult?.total?.[0]?.count ?? 0;

    if (ids.length === 0) {
      return { applications: [], total, page, limit };
    }

    const docs = await populateActiveApplications(
      Application.find({ _id: { $in: ids } })
    ).lean();

    // $in does not preserve the aggregation's sort order — restore it.
    const orderMap = new Map(ids.map((id, index) => [id.toString(), index]));
    docs.sort(
      (a, b) => orderMap.get(a._id.toString()) - orderMap.get(b._id.toString())
    );

    return { applications: docs, total, page, limit };
  },

  /**
   * Deadline distribution for the "Open Applications Distribution" chart,
   * computed entirely in the DB so only the {name, active, potentials} buckets
   * are returned (not the full application set).
   *
   * Mirrors the frontend frequencyDistribution + application_deadline_V2_calculator:
   * - only OPEN applications (closed === '-');
   * - bucketed by the derived deadline string ("YYYY/MM/DD" or "{year}-Rolling",
   *   with the WS/SS year-prior adjustment);
   * - kept when the deadline is within ~1 year (or rolling);
   * - `active` = decided ('O'), `potentials` = undecided ('-').
   *
   * @param {string[]} studentIds active/supervised student ids to scope to
   * @returns {Array<{ name: string, active: number, potentials: number }>}
   */
  async getActiveStudentsApplicationsDeadlineDistribution(
    req,
    { studentIds = [] }
  ) {
    const Application = req.db.model('Application');
    if (studentIds.length === 0) {
      return [];
    }

    const objectIds = studentIds.map(
      (id) => new mongoose.Types.ObjectId(id.toString())
    );
    // Frontend keeps deadlines with differenceInDays(deadline, now) < 365, i.e.
    // earlier than one year from now (rolling deadlines are kept separately).
    const cutoff = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { studentId: { $in: objectIds }, closed: '-' } },
      {
        $lookup: {
          from: 'programs',
          let: { pid: '$programId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
            { $project: { semester: 1, application_deadline: 1 } }
          ],
          as: 'prog'
        }
      },
      { $unwind: { path: '$prog', preserveNullAndEmptyArrays: false } },
      ...DEADLINE_DATE_STAGES,
      {
        $addFields: {
          // Bucket label matching application_deadline_V2_calculator output.
          bucketKey: {
            $cond: [
              '$_isRolling',
              {
                $concat: [{ $ifNull: ['$application_year', ''] }, '-Rolling']
              },
              {
                $cond: [
                  { $ne: ['$deadlineDate', null] },
                  {
                    $concat: [
                      { $toString: '$_dlYear' },
                      '/',
                      { $toString: { $arrayElemAt: ['$_dlParts', 0] } },
                      '/',
                      { $toString: { $arrayElemAt: ['$_dlParts', 1] } }
                    ]
                  },
                  null
                ]
              }
            ]
          }
        }
      },
      // Keep rolling, or real deadlines within the next year.
      {
        $match: {
          $or: [{ _isRolling: true }, { deadlineDate: { $lt: cutoff } }]
        }
      },
      { $match: { bucketKey: { $ne: null } } },
      {
        $group: {
          _id: '$bucketKey',
          active: { $sum: { $cond: [{ $eq: ['$decided', 'O'] }, 1, 0] } },
          potentials: { $sum: { $cond: [{ $eq: ['$decided', '-'] }, 1, 0] } }
        }
      },
      // Drop empty date buckets; rolling buckets are kept regardless.
      {
        $match: {
          $or: [
            { _id: { $regex: 'Rolling', $options: 'i' } },
            { active: { $gt: 0 } },
            { potentials: { $gt: 0 } }
          ]
        }
      },
      { $project: { _id: 0, name: '$_id', active: 1, potentials: 1 } },
      { $sort: { name: 1 } }
    ];

    return Application.aggregate(pipeline).allowDiskUse(true);
  },

  /**
   * Distinct programs referenced by the given students' applications, with the
   * fields the "Programs Update Status" table needs. Computed in the DB so only
   * the small program list is returned (not the full applications).
   *
   * @param {string[]} studentIds active/supervised student ids to scope to
   * @param {string} [decided] when set (e.g. 'O'), only programs that have a
   *   decided application are returned
   * @returns {Array<{program_id, school, program_name, degree, semester, whoupdated, updatedAt}>}
   */
  async getApplicationProgramsUpdateStatus(req, { studentIds = [], decided }) {
    const Application = req.db.model('Application');
    if (studentIds.length === 0) {
      return [];
    }

    const objectIds = studentIds.map(
      (id) => new mongoose.Types.ObjectId(id.toString())
    );
    const match = {
      studentId: { $in: objectIds },
      programId: { $ne: null }
    };
    if (decided) {
      match.decided = decided;
    }

    const pipeline = [
      { $match: match },
      { $group: { _id: '$programId' } },
      {
        $lookup: {
          from: 'programs',
          localField: '_id',
          foreignField: '_id',
          as: 'prog'
        }
      },
      { $unwind: { path: '$prog', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          _id: 0,
          program_id: { $toString: '$_id' },
          school: '$prog.school',
          program_name: '$prog.program_name',
          degree: '$prog.degree',
          semester: '$prog.semester',
          whoupdated: '$prog.whoupdated',
          updatedAt: '$prog.updatedAt'
        }
      },
      { $sort: { school: 1, program_name: 1 } }
    ];

    return Application.aggregate(pipeline).allowDiskUse(true);
  },

  /**
   * Application status counts for a set of students, computed in the DB (for the
   * AgentPage stat cards). Returns zeros when there are no students.
   *
   * @param {string[]} studentIds
   * @returns {{ totalApplications, decidedYesApplications, decidedNoApplications,
   *   undecidedApplications, submittedApplications, pendingApplications }}
   */
  async getApplicationStatusStats(req, { studentIds = [] }) {
    const zero = {
      totalApplications: 0,
      decidedYesApplications: 0,
      decidedNoApplications: 0,
      undecidedApplications: 0,
      submittedApplications: 0,
      pendingApplications: 0
    };
    if (studentIds.length === 0) {
      return zero;
    }

    const objectIds = studentIds.map(
      (id) => new mongoose.Types.ObjectId(id.toString())
    );

    const [result] = await req.db.model('Application').aggregate([
      { $match: { studentId: { $in: objectIds } } },
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          decidedYesApplications: {
            $sum: { $cond: [{ $eq: ['$decided', 'O'] }, 1, 0] }
          },
          decidedNoApplications: {
            $sum: { $cond: [{ $eq: ['$decided', 'X'] }, 1, 0] }
          },
          // Anything not decided 'O'/'X' (incl. '-' or missing) is undecided.
          undecidedApplications: {
            $sum: { $cond: [{ $in: ['$decided', ['O', 'X']] }, 0, 1] }
          },
          submittedApplications: {
            $sum: { $cond: [{ $eq: ['$closed', 'O'] }, 1, 0] }
          },
          // Decided to apply but not yet submitted.
          pendingApplications: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ['$decided', 'O'] }, { $ne: ['$closed', 'O'] }]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $project: { _id: 0 } }
    ]);

    return result || zero;
  },
  getApplications(req, filter = {}, select = [], populate = true) {
    const query = req.db.model('Application').find(filter);
    if (!!populate && populate !== 'false') {
      query.populate('programId');
      query.populate({
        path: 'doc_modification_thread.doc_thread_id',
        select: 'file_type isFinalVersion updatedAt messages',
        populate: {
          path: 'messages',
          options: {
            sort: { createdAt: -1 },
            limit: 1
          },
          populate: {
            path: 'user_id',
            select: 'firstname lastname pictureUrl'
          }
        }
      });
    }
    if (select.length > 0) {
      query.select(select.join(' '));
    }
    return query;
  },
  async getApplicationsWithStudentDetails(req, filter) {
    const applications = await req.db
      .model('Application')
      .find(filter)
      .populate({
        path: 'studentId',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate(
        'programId',
        'school program_name degree semester lang country application_deadline application_start'
      )
      .populate('doc_modification_thread.doc_thread_id', '-messages')
      .lean();
    return applications;
  },
  async getApplicationsByStudentId(req, studentId) {
    const applications = await this.getApplications(req, { studentId }).lean();
    return applications;
  },
  async getApplicationsWithCredentialsByStudentId(req, studentId) {
    const applications = await this.getApplications(req, { studentId })
      .select(
        '+portal_credentials.application_portal_a.account +portal_credentials.application_portal_b.account +portal_credentials.application_portal_a.password +portal_credentials.application_portal_b.password'
      )
      .lean();
    return applications;
  },
  async getApplicationsByProgramId(req, programId) {
    const applications = await this.getApplications(req, { programId }).lean();
    return applications;
  },
  async getApplicationById(req, applicationId) {
    const application = await req.db
      .model('Application')
      .findById(applicationId)
      .populate('programId')
      .populate('doc_modification_thread.doc_thread_id', '-messages');
    return application;
  },
  async updateApplication(req, filter, payload) {
    const application = await req.db
      .model('Application')
      .findOneAndUpdate(filter, payload, { new: true })
      .populate('programId')
      .lean();
    return application;
  },
  // TODO: interview threads is missing! (orphan interview threads)
  async deleteApplication(req, application_id) {
    const application = await this.getApplicationById(req, application_id);

    if (!application) {
      logger.error('deleteApplication: Invalid application id');
      throw new ErrorResponse(404, 'Application not found');
    }

    const threads = await req.db
      .model('Documentthread')
      .find({ application_id })
      .lean();

    // checking if delete is safe?
    for (let i = 0; i < threads.length; i += 1) {
      if (threads[i].messages.length !== 0) {
        logger.error(
          'deleteApplication: Some ML/RL/Essay discussion threads are existed and not empty.'
        );
        throw new ErrorResponse(
          409,
          'Some ML/RL/Essay discussion threads are existed and not empty. Please make sure the non-empty discussion threads are ready to be deleted and delete those thread first and then delete this application.'
        );
      }
    }

    // Only delete threads when all empty
    const threadIds = threads.map(
      (thread) => new mongoose.Types.ObjectId(thread._id.toString())
    );
    logger.info('Trying to delete empty threads');
    await req.db.model('Documentthread').deleteMany({
      _id: { $in: threadIds }
    });
    // TODO: delete VPD
    await req.db.model('Application').findByIdAndDelete(application_id);
  },
  async updateApplicationsBulk(req, updates) {
    const result = await req.db.model('Application').bulkWrite(updates);
    return result;
  },
  async getApplicationConflicts(req) {
    const applicationConflicts = await req.db.model('Application').aggregate([
      {
        $match: {
          decided: 'O',
          closed: '-',
          programId: { $ne: null }, // optional: ignore null programIds
          studentId: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$programId',
          studentIds: { $addToSet: '$studentId' }, // avoid duplicates
          applicationCount: { $sum: 1 }
        }
      },
      {
        $match: {
          applicationCount: { $gt: 1 } // optional: only programs with >1 applicant
        }
      },
      // Lookup program info
      {
        $lookup: {
          from: 'programs',
          localField: '_id',
          foreignField: '_id',
          as: 'programInfo'
        }
      },
      {
        $unwind: '$programInfo'
      },
      // Lookup student info
      {
        $lookup: {
          from: 'users',
          localField: 'studentIds',
          foreignField: '_id',
          as: 'students'
        }
      },
      // Project only necessary fields
      {
        $project: {
          _id: 0,
          programId: '$_id',
          program: {
            _id: '$programInfo._id',
            school: '$programInfo.school',
            program_name: '$programInfo.program_name',
            application_deadline: '$programInfo.application_deadline',
            degree: '$programInfo.degree',
            semester: '$programInfo.semester'
          },
          application_year: '$_id.application_year',
          applicationCount: 1,
          students: {
            $map: {
              input: '$students',
              as: 's',
              in: {
                _id: '$$s._id',
                firstname: '$$s.firstname',
                lastname: '$$s.lastname'
              }
            }
          }
        }
      }
    ]);

    return applicationConflicts;
  }
};

module.exports = ApplicationService;
