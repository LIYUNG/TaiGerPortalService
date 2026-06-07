const mongoose = require('mongoose');
const StudentService = require('./students');
const DocumentthreadDAO = require('../dao/documentthread.dao');
const { Student, Application, Documentthread } = require('../models');
const {
  createApplicationThreadV2
} = require('../utils/modelHelper/versionControl');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Mirrors APPROVAL_COUNTRIES + the 270-day stale rule from the frontend
// calculateApplicationLockStatus, so the "Locked/Unlocked" status can be
// computed in the DB.
const APPROVAL_COUNTRIES = ['de', 'nl', 'uk', 'ch', 'se', 'at'];
const STALE_PROGRAM_MS = 270 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Frontend table column id -> aggregation sort path.
const THREAD_SORT_FIELD_MAP = {
  deadline: 'deadlineDate',
  days_left: 'deadlineDate',
  document_name: 'document_name',
  updatedAt: 'updatedAt',
  firstname_lastname: 'student.firstname'
};

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

// file_type: single value, comma-separated list ($in), or default (not Interview).
const buildFileTypeCond = (fileTypes) => {
  if (fileTypes.length > 1) {
    return { $in: fileTypes };
  }
  if (fileTypes.length === 1) {
    return fileTypes[0];
  }
  return { $ne: 'Interview' };
};

const parseActiveThreadsQuery = (query = {}) => {
  const { page, limit, search, sortBy, sortOrder } = query;
  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const sortPath = THREAD_SORT_FIELD_MAP[sortBy] || 'deadlineDate';
  const sortDir = String(sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const trim = (v) => {
    if (v === undefined || v === '') {
      return undefined;
    }
    return String(v).trim();
  };

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    search: typeof search === 'string' ? search.trim() : '',
    // The logged-in user, for the viewer-dependent Essay tabs (new/fav/followup).
    viewerId: trim(query.viewerId),
    // High-value subset of filters (rest of the columns stay display-only).
    filters: {
      name: trim(query.name),
      document_name: trim(query.document_name),
      file_type: trim(query.file_type),
      lang: trim(query.lang),
      status: trim(query.status),
      // Year/month text match against the displayed deadline string
      // (e.g. "2025/09"); also matches "Rolling"/"WITHDRAW".
      deadline: trim(query.deadline),
      category: trim(query.category) || 'all'
    },
    sort: { [sortPath]: sortDir, _id: 1 }
  };
};

// Per-thread category classification booleans, shared by the paginated list and
// the counts endpoint. `viewerId` is needed for the viewer-dependent tabs.
const THREAD_CATEGORY_FIELDS = (viewerId) => ({
  _hasMessages: { $gt: [{ $size: { $ifNull: ['$messages', []] } }, 0] },
  _isFinal: { $eq: ['$isFinalVersion', true] },
  _noWriter: {
    $eq: [{ $size: { $ifNull: ['$outsourced_user_id', []] } }, 0]
  },
  _latestById: {
    $cond: [
      { $gt: [{ $size: { $ifNull: ['$messages', []] } }, 0] },
      {
        $toString: {
          $arrayElemAt: [{ $ifNull: ['$messages.user_id', []] }, -1]
        }
      },
      '- None - '
    ]
  },
  _favForViewer: viewerId
    ? {
        $in: [
          viewerId,
          {
            $map: {
              input: { $ifNull: ['$flag_by_user_id', []] },
              as: 'f',
              in: { $toString: '$$f' }
            }
          }
        ]
      }
    : false
});

// Build a $match condition (on the computed category fields) for one tab.
const buildCategoryMatch = (category, viewerId) => {
  switch (category) {
    case 'closed':
      return { _isFinal: true };
    case 'in_progress':
      return { _isFinal: false, _hasMessages: true };
    case 'no_input':
      return { _isFinal: false, _hasMessages: false };
    case 'no_writer':
      return { _isFinal: false, _noWriter: true };
    case 'new_message':
      return {
        _isFinal: false,
        _latestById: { $nin: ['- None - ', viewerId ?? '__none__'] }
      };
    case 'fav':
      return { _isFinal: false, _favForViewer: true };
    case 'followup':
      // The viewer sent the last message and is awaiting a reply.
      return {
        _isFinal: false,
        _latestById: viewerId ?? '__none__'
      };
    case 'pending_progress':
      // "No Action": the thread has no messages yet.
      return { _isFinal: false, _hasMessages: false };
    case 'all':
    default:
      return null;
  }
};

const DocumentThreadService = {
  // Default-connection helpers (no req) used by the migrated application flow.
  newThread(payload) {
    return DocumentthreadDAO.newThread(payload);
  },
  countThreads(filter) {
    return DocumentthreadDAO.countThreads(filter);
  },
  createThread(payload) {
    return DocumentthreadDAO.createThread(payload);
  },
  deleteThreadById(id) {
    return DocumentthreadDAO.deleteThreadById(id);
  },
  updateThreadFields(id, payload) {
    return DocumentthreadDAO.updateThreadFields(id, payload);
  },
  getThreadByIdLean(id) {
    return DocumentthreadDAO.getThreadByIdLean(id);
  },
  findThreads(filter, select) {
    return DocumentthreadDAO.findThreads(filter, select);
  },
  findThreadsSelectSorted(filter, select, sort) {
    return DocumentthreadDAO.findThreadsSelectSorted(filter, select, sort);
  },
  getThreadDocById(id) {
    return DocumentthreadDAO.getThreadDocById(id);
  },
  getThreadDocByIdPopulated(id, populates) {
    return DocumentthreadDAO.getThreadDocByIdPopulated(id, populates);
  },
  findThreadByIdPopulated(id, populates) {
    return DocumentthreadDAO.findThreadByIdPopulated(id, populates);
  },
  findOneThreadPopulated(filter, populates) {
    return DocumentthreadDAO.findOneThreadPopulated(filter, populates);
  },
  findOneThreadDoc(filter) {
    return DocumentthreadDAO.findOneThreadDoc(filter);
  },
  clearAllOutsourcedUsers() {
    return DocumentthreadDAO.clearAllOutsourcedUsers();
  },
  setMessageIgnore(messageId, ignoreMessageState) {
    return DocumentthreadDAO.setMessageIgnore(messageId, ignoreMessageState);
  },
  // Wraps the version-control thread-creation helper with the central
  // default-connection models (no req).
  createApplicationThread(studentId, applicationId, documentCategory) {
    return createApplicationThreadV2(
      {
        StudentModel: Student,
        ApplicationModel: Application,
        DocumentthreadModel: Documentthread
      },
      studentId,
      applicationId,
      documentCategory
    );
  },

  async getThreadById(messagesThreadId) {
    const thread = await Documentthread.findById(messagesThreadId)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference pictureUrl'
      )
      .populate('messages.user_id', 'firstname lastname role archiv pictureUrl')
      .populate('program_id')
      .populate(
        'outsourced_user_id',
        'firstname lastname role archiv pictureUrl'
      )
      .lean();

    return thread;
  },
  async getStudentThreadsByStudentId(studentId) {
    const threads = await Documentthread.find({ student_id: studentId })
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang country updatedAt'
      )
      .populate('student_id', 'firstname lastname pictureUrl')
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname role pictureUrl')
      .populate('outsourced_user_id', 'firstname lastname role pictureUrl')
      .lean();

    const filteredThreads = threads.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getStudentsThreadsByTaiGerUserId(userId, documentThreadFilter = {}) {
    const threads = await Documentthread.find(documentThreadFilter)
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email pictureUrl'
      )
      .populate({
        path: 'student_id',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('application_id')
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang application_start country updatedAt'
      )
      .lean();

    const filteredThreads = threads.filter(
      (thread) =>
        (thread.student_id?.agents.some(
          (agent) => agent._id.toString() === userId
        ) ||
          thread.student_id?.editors.some(
            (editor) => editor._id.toString() === userId
          ) ||
          (thread.file_type === 'Essay' &&
            thread.outsourced_user_id?.some(
              (o_user_id) => o_user_id._id.toString() === userId
            ))) &&
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview' &&
        (thread.student_id?.archiv === false ||
          thread.student_id?.archiv === undefined)
    );

    return filteredThreads;
  },
  async getAllStudentsThreads(query) {
    const queryFilter = { ...query };
    const activeStudentsIds = await StudentService.fetchSimpleStudents({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    queryFilter.student_id = {
      $in: activeStudentsIds.map((student) => student._id)
    };
    const threads = await Documentthread.find(queryFilter)
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email pictureUrl'
      )
      .populate({
        path: 'student_id',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('application_id')
      .populate(
        'program_id',
        'school program_name application_deadline degree semester essay_difficulty lang country updatedAt'
      )
      .lean();

    const filteredThreads = threads.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },

  /**
   * Server-side paginated / sorted / filtered active document threads for the
   * CVMLRL center. All the per-row derivations (deadline, document name,
   * message-derived counts/latest-reply, lock status) are computed in the DB so
   * only slim rows are returned — the heavy `messages[]` arrays and full
   * application docs never leave Mongo.
   *
   * @param {string[]} studentIds active (non-archived) student ids
   * @param {object} query raw req.query (page/limit/sort/search/filters/category)
   */
  async getActiveThreadsPaginated({
    studentIds = [],
    outsourcedUserId = null,
    query = {}
  }) {
    const { page, limit, skip, search, viewerId, filters, sort } =
      parseActiveThreadsQuery(query);

    if (studentIds.length === 0) {
      return { threads: [], total: 0, page, limit };
    }

    const objectIds = studentIds.map(
      (id) => new mongoose.Types.ObjectId(id.toString())
    );
    const now = new Date();

    // ---- pre-lookup match: cheap fields on the thread itself ----
    // file_type may be a single value or a comma-separated list ($in).
    const fileTypeCond = buildFileTypeCond(parseArrayParam(filters.file_type));

    const preMatch = { file_type: fileTypeCond };
    const scopeAnd = [];
    // Scope: the given students, plus (for the "my students" view) Essay threads
    // outsourced to the viewer even if their student isn't in the supervised set.
    if (outsourcedUserId) {
      scopeAnd.push({
        $or: [
          { student_id: { $in: objectIds } },
          {
            file_type: 'Essay',
            outsourced_user_id: new mongoose.Types.ObjectId(outsourcedUserId)
          }
        ]
      });
    } else {
      preMatch.student_id = { $in: objectIds };
    }
    // Exclude certain doc types (e.g. agent-support docs) UNLESS the viewer is
    // an outsourced collaborator on that specific thread.
    const excludeTypes = parseArrayParam(query.excludeFileType);
    if (excludeTypes.length > 0) {
      const orConds = [{ file_type: { $nin: excludeTypes } }];
      if (viewerId) {
        orConds.push({
          outsourced_user_id: new mongoose.Types.ObjectId(viewerId)
        });
      }
      scopeAnd.push({ $or: orConds });
    }
    if (scopeAnd.length > 0) {
      preMatch.$and = scopeAnd;
    }
    // Cheap pre-filter on isFinalVersion; the finer category distinction (which
    // may depend on computed fields / the viewer) is applied post-lookup.
    if (filters.category === 'closed') {
      preMatch.isFinalVersion = true;
    } else if (filters.category && filters.category !== 'all') {
      preMatch.isFinalVersion = { $ne: true };
    }

    const escapedSearch = search ? escapeRegex(search) : null;

    const pipeline = [
      { $match: preMatch },
      // application (decided/closed/year/lock) — general threads have none.
      {
        $lookup: {
          from: 'applications',
          let: { aid: '$application_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$aid'] } } },
            {
              $project: {
                decided: 1,
                closed: 1,
                application_year: 1,
                isLocked: 1
              }
            }
          ],
          as: 'app'
        }
      },
      // app lookup returns an array; flag presence explicitly (an $unwind of an
      // empty array leaves the field *missing*, which $eq null does not catch).
      {
        $addFields: {
          _hasApp: { $gt: [{ $size: '$app' }, 0] },
          app: { $arrayElemAt: ['$app', 0] }
        }
      },
      // Only decided ('O') applications, or general (no application) threads.
      {
        $match: {
          $or: [{ _hasApp: false }, { 'app.decided': 'O' }]
        }
      },
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
                semester: 1,
                lang: 1,
                country: 1,
                application_deadline: 1,
                essay_difficulty: 1,
                updatedAt: 1
              }
            }
          ],
          as: 'prog'
        }
      },
      { $unwind: { path: '$prog', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          let: { sid: '$student_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$sid'] } } },
            {
              $project: {
                firstname: 1,
                lastname: 1,
                firstname_chinese: 1,
                lastname_chinese: 1,
                attributes: 1,
                editors: 1,
                agents: 1,
                archiv: 1
              }
            }
          ],
          as: 'student'
        }
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
      // Editor + outsourced-writer names (for the Editors/Writer column).
      {
        $lookup: {
          from: 'users',
          let: { ids: { $ifNull: ['$student.editors', []] } },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$ids'] } } },
            { $project: { firstname: 1 } }
          ],
          as: 'editors'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { ids: { $ifNull: ['$student.agents', []] } },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$ids'] } } },
            { $project: { firstname: 1 } }
          ],
          as: 'agents'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { ids: { $ifNull: ['$outsourced_user_id', []] } },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$ids'] } } },
            { $project: { firstname: 1 } }
          ],
          as: 'outsourced_user_id'
        }
      },
      // ---- message-derived fields (computed in DB; messages never returned) ----
      {
        $addFields: {
          _hasMessages: { $gt: [{ $size: { $ifNull: ['$messages', []] } }, 0] },
          _lastMsg: { $arrayElemAt: [{ $ifNull: ['$messages', []] }, -1] },
          _msgStats: {
            $reduce: {
              input: { $ifNull: ['$messages', []] },
              initialValue: { sm: 0, sf: 0, em: 0, ef: 0 },
              in: {
                $let: {
                  vars: {
                    isStudent: {
                      $eq: [
                        { $toString: '$$this.user_id' },
                        { $toString: '$student_id' }
                      ]
                    },
                    nf: { $size: { $ifNull: ['$$this.file', []] } }
                  },
                  in: {
                    sm: {
                      $add: ['$$value.sm', { $cond: ['$$isStudent', 1, 0] }]
                    },
                    sf: {
                      $add: [
                        '$$value.sf',
                        { $cond: ['$$isStudent', '$$nf', 0] }
                      ]
                    },
                    em: {
                      $add: ['$$value.em', { $cond: ['$$isStudent', 0, 1] }]
                    },
                    ef: {
                      $add: [
                        '$$value.ef',
                        { $cond: ['$$isStudent', 0, '$$nf'] }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      },
      // ---- deadline (mirrors application_deadline_V2_calculator) ----
      {
        $addFields: {
          _appYearInt: {
            $convert: {
              input: '$app.application_year',
              to: 'int',
              onError: null,
              onNull: null
            }
          },
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
                  { $eq: ['$_hasApp', false] },
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
      },
      // last-message sender name (for "Latest Reply")
      {
        $lookup: {
          from: 'users',
          let: { uid: '$_lastMsg.user_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
            { $project: { firstname: 1, lastname: 1 } }
          ],
          as: '_lastMsgUser'
        }
      },
      { $unwind: { path: '$_lastMsgUser', preserveNullAndEmptyArrays: true } },
      // ---- the row's display + filter/sort fields ----
      {
        $addFields: {
          firstname_lastname: {
            $concat: [
              { $ifNull: ['$student.firstname', ''] },
              ', ',
              { $ifNull: ['$student.lastname', ''] }
            ]
          },
          document_name: {
            $cond: [
              { $eq: ['$_hasApp', false] },
              { $ifNull: ['$file_type', ''] },
              {
                $concat: [
                  { $ifNull: ['$file_type', ''] },
                  ' - ',
                  { $ifNull: ['$prog.school', ''] },
                  ' - ',
                  { $ifNull: ['$prog.degree', ''] },
                  ' -',
                  { $ifNull: ['$prog.program_name', ''] }
                ]
              }
            ]
          },
          lang: {
            $cond: [
              { $eq: ['$_hasApp', false] },
              '',
              { $ifNull: ['$prog.lang', ''] }
            ]
          },
          deadline: {
            $switch: {
              branches: [
                { case: { $eq: ['$_hasApp', false] }, then: '-' },
                { case: { $eq: ['$app.closed', 'X'] }, then: 'WITHDRAW' },
                {
                  case: '$_isRolling',
                  then: {
                    $concat: [
                      { $ifNull: ['$app.application_year', ''] },
                      '-Rolling'
                    ]
                  }
                },
                {
                  case: { $ne: ['$deadlineDate', null] },
                  then: {
                    $concat: [
                      { $toString: '$_dlYear' },
                      '/',
                      { $toString: { $arrayElemAt: ['$_dlParts', 0] } },
                      '/',
                      { $toString: { $arrayElemAt: ['$_dlParts', 1] } }
                    ]
                  }
                }
              ],
              default: 'No Data'
            }
          },
          days_left: {
            $cond: [
              { $ne: ['$deadlineDate', null] },
              {
                $floor: {
                  $divide: [{ $subtract: ['$deadlineDate', now] }, DAY_MS]
                }
              },
              '-'
            ]
          },
          aged_days: {
            $floor: {
              $divide: [
                { $subtract: [now, { $ifNull: ['$updatedAt', now] }] },
                DAY_MS
              ]
            }
          },
          latest_message_left_by_id: {
            $cond: [
              '$_hasMessages',
              { $toString: '$_lastMsg.user_id' },
              '- None - '
            ]
          },
          latest_reply: {
            $cond: [
              '$_hasMessages',
              {
                $concat: [
                  { $ifNull: ['$_lastMsgUser.firstname', ''] },
                  ' ',
                  { $ifNull: ['$_lastMsgUser.lastname', ''] }
                ]
              },
              '- None - '
            ]
          },
          number_input_from_student: {
            $concat: [
              { $toString: '$_msgStats.sm' },
              '/',
              { $toString: '$_msgStats.sf' }
            ]
          },
          number_input_from_editors: {
            $concat: [
              { $toString: '$_msgStats.em' },
              '/',
              { $toString: '$_msgStats.ef' }
            ]
          },
          isLocked: {
            $cond: [
              { $eq: ['$_hasApp', false] },
              false,
              {
                $let: {
                  vars: {
                    isStale: {
                      $or: [
                        { $eq: [{ $ifNull: ['$prog.updatedAt', null] }, null] },
                        {
                          $gte: [
                            { $subtract: [now, '$prog.updatedAt'] },
                            STALE_PROGRAM_MS
                          ]
                        }
                      ]
                    },
                    isApproval: {
                      $in: [
                        { $toLower: { $ifNull: ['$prog.country', ''] } },
                        APPROVAL_COUNTRIES
                      ]
                    }
                  },
                  in: {
                    $cond: [
                      '$$isStale',
                      true,
                      {
                        $cond: [
                          '$$isApproval',
                          false,
                          { $eq: ['$app.isLocked', true] }
                        ]
                      }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    ];

    // category-classification booleans (+ joined agent/writer names for Essay).
    pipeline.push({
      $addFields: {
        ...THREAD_CATEGORY_FIELDS(viewerId),
        agents_joined: {
          $trim: {
            input: {
              $reduce: {
                input: { $ifNull: ['$agents.firstname', []] },
                initialValue: '',
                in: { $concat: ['$$value', ' ', '$$this'] }
              }
            }
          }
        },
        outsourced_user_name_joined: {
          $trim: {
            input: {
              $reduce: {
                input: { $ifNull: ['$outsourced_user_id.firstname', []] },
                initialValue: '',
                in: { $concat: ['$$value', ' ', '$$this'] }
              }
            }
          }
        }
      }
    });

    // tab category filter (applied after the computed fields are available).
    const categoryMatch = buildCategoryMatch(filters.category, viewerId);
    if (categoryMatch) {
      pipeline.push({ $match: categoryMatch });
    }

    // ---- post-lookup filters (computed/joined fields) ----
    // Exclude archived students (the essay-outsourced branch can surface them).
    const andConditions = [{ 'student.archiv': { $ne: true } }];
    if (filters.name) {
      const p = escapeRegex(filters.name);
      andConditions.push({
        $or: [
          { 'student.firstname': { $regex: p, $options: 'i' } },
          { 'student.lastname': { $regex: p, $options: 'i' } }
        ]
      });
    }
    if (filters.document_name) {
      andConditions.push({
        document_name: {
          $regex: escapeRegex(filters.document_name),
          $options: 'i'
        }
      });
    }
    if (filters.lang) {
      andConditions.push({
        lang: { $regex: escapeRegex(filters.lang), $options: 'i' }
      });
    }
    if (filters.deadline) {
      // Match against the computed display string (e.g. "2025/09/15",
      // "2026-Rolling", "WITHDRAW"), so "2025/09" narrows to that month.
      andConditions.push({
        deadline: { $regex: escapeRegex(filters.deadline), $options: 'i' }
      });
    }
    if (filters.status === 'Locked' || filters.status === 'Unlocked') {
      andConditions.push({ isLocked: filters.status === 'Locked' });
    }
    if (escapedSearch) {
      andConditions.push({
        $or: [
          { firstname_lastname: { $regex: escapedSearch, $options: 'i' } },
          { document_name: { $regex: escapedSearch, $options: 'i' } },
          { file_type: { $regex: escapedSearch, $options: 'i' } },
          { 'prog.program_name': { $regex: escapedSearch, $options: 'i' } },
          { 'prog.school': { $regex: escapedSearch, $options: 'i' } }
        ]
      });
    }
    if (andConditions.length > 0) {
      pipeline.push({ $match: { $and: andConditions } });
    }

    pipeline.push({
      $facet: {
        rows: [
          { $sort: sort },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              thread_id: { $toString: '$_id' },
              id: { $toString: '$_id' },
              student_id: { $toString: '$student_id' },
              program_id: {
                $cond: [
                  { $ifNull: ['$program_id', false] },
                  { $toString: '$program_id' },
                  null
                ]
              },
              firstname_lastname: 1,
              file_type: 1,
              document_name: 1,
              deadline: 1,
              days_left: 1,
              lang: 1,
              school: '$prog.school',
              program_name: '$prog.program_name',
              degree: '$prog.degree',
              semester: '$prog.semester',
              country: '$prog.country',
              isApplicationLocked: '$isLocked',
              isProgramLocked: '$isLocked',
              isFinalVersion: 1,
              show: true,
              latest_message_left_by_id: 1,
              latest_reply: 1,
              number_input_from_student: 1,
              number_input_from_editors: 1,
              aged_days: 1,
              updatedAt: 1,
              attributes: '$student.attributes',
              editors: 1,
              agents: 1,
              agents_joined: 1,
              outsourced_user_id: 1,
              outsourced_user_name_joined: 1,
              essay_difficulty: '$prog.essay_difficulty',
              flag_by_user_id: {
                $map: {
                  input: { $ifNull: ['$flag_by_user_id', []] },
                  as: 'f',
                  in: { $toString: '$$f' }
                }
              }
            }
          }
        ],
        total: [{ $count: 'count' }]
      }
    });

    const [result] = await Documentthread.aggregate(pipeline).allowDiskUse(
      true
    );
    const threads = result?.rows ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    return { threads, total, page, limit };
  },

  /**
   * Per-tab counts for the CVMLRL / Essay dashboards, computed in the DB (tiny
   * payload). Categories are independent of the column filters/search (they
   * mirror the original full-data tab partitions). `query.file_type` scopes to
   * a doc type (Essay); `query.viewerId` drives the viewer-dependent tabs.
   */
  async getActiveThreadsCounts({
    studentIds = [],
    outsourcedUserId = null,
    query = {}
  }) {
    const zero = {
      all: 0,
      closed: 0,
      in_progress: 0,
      no_input: 0,
      no_writer: 0,
      new_message: 0,
      fav: 0,
      followup: 0,
      pending_progress: 0
    };
    if (studentIds.length === 0 && !outsourcedUserId) {
      return zero;
    }

    const objectIds = studentIds.map(
      (id) => new mongoose.Types.ObjectId(id.toString())
    );
    const fileTypeCond = buildFileTypeCond(parseArrayParam(query.file_type));
    const viewerId = query.viewerId ? String(query.viewerId).trim() : null;
    const viewerKey = viewerId ?? '__none__';
    const open = (cond) => ({
      $sum: { $cond: [{ $and: [{ $eq: ['$_isFinal', false] }, cond] }, 1, 0] }
    });

    const preMatch = { file_type: fileTypeCond };
    const scopeAnd = [];
    if (outsourcedUserId) {
      scopeAnd.push({
        $or: [
          { student_id: { $in: objectIds } },
          {
            file_type: 'Essay',
            outsourced_user_id: new mongoose.Types.ObjectId(outsourcedUserId)
          }
        ]
      });
    } else {
      preMatch.student_id = { $in: objectIds };
    }
    // Exclude certain doc types (e.g. agent-support docs) UNLESS the viewer is
    // an outsourced collaborator on that specific thread.
    const excludeTypes = parseArrayParam(query.excludeFileType);
    if (excludeTypes.length > 0) {
      const orConds = [{ file_type: { $nin: excludeTypes } }];
      if (viewerId) {
        orConds.push({
          outsourced_user_id: new mongoose.Types.ObjectId(viewerId)
        });
      }
      scopeAnd.push({ $or: orConds });
    }
    if (scopeAnd.length > 0) {
      preMatch.$and = scopeAnd;
    }

    const [result] = await Documentthread.aggregate([
      { $match: preMatch },
      {
        $lookup: {
          from: 'users',
          let: { sid: '$student_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$sid'] } } },
            { $project: { archiv: 1 } }
          ],
          as: '_student'
        }
      },
      { $unwind: { path: '$_student', preserveNullAndEmptyArrays: false } },
      { $match: { '_student.archiv': { $ne: true } } },
      {
        $lookup: {
          from: 'applications',
          let: { aid: '$application_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$aid'] } } },
            { $project: { decided: 1 } }
          ],
          as: 'app'
        }
      },
      {
        $addFields: {
          _hasApp: { $gt: [{ $size: '$app' }, 0] },
          app: { $arrayElemAt: ['$app', 0] }
        }
      },
      { $match: { $or: [{ _hasApp: false }, { 'app.decided': 'O' }] } },
      { $addFields: THREAD_CATEGORY_FIELDS(viewerId) },
      {
        $group: {
          _id: null,
          all: { $sum: 1 },
          closed: { $sum: { $cond: ['$_isFinal', 1, 0] } },
          in_progress: open('$_hasMessages'),
          no_input: open({ $eq: ['$_hasMessages', false] }),
          no_writer: open('$_noWriter'),
          new_message: open({
            $not: [{ $in: ['$_latestById', ['- None - ', viewerKey]] }]
          }),
          fav: open('$_favForViewer'),
          // Follow up: viewer sent the last message (awaiting a reply).
          followup: open({ $eq: ['$_latestById', viewerKey] }),
          // No Action: the thread has no messages yet.
          pending_progress: open({ $eq: ['$_hasMessages', false] })
        }
      },
      { $project: { _id: 0 } }
    ]).allowDiskUse(true);

    return result ? { ...zero, ...result } : zero;
  },

  async getThreads(filter) {
    const threads = await Documentthread.find(filter)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference pictureUrl'
      )
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname role pictureUrl')
      .populate('program_id')
      .populate('outsourced_user_id', 'firstname lastname role pictureUrl')
      .lean();

    return threads;
  },
  async updateThreadById(threadId, payload) {
    return Documentthread.findByIdAndUpdate(threadId, payload, {
      new: true
    }).lean();
  },
  async updateThread(filter, payload) {
    return Documentthread.findOneAndUpdate(filter, payload, {
      new: true
    }).lean();
  }
};

module.exports = DocumentThreadService;
