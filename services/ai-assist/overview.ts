import { differenceInDays } from 'date-fns';
import { Role } from '@taiger-common/core';

import { getAccessibleStudentFilter } from './studentAccess';
import { normalizeUser } from './normalizers';
import { application_deadline_V2_calculator } from '../../constants';
import StudentService from '../students';
import ApplicationService from '../applications';
import DocumentThreadService from '../documentthreads';
import CommunicationService from '../communications';

// Cross-portfolio "what needs my attention" aggregation. Shared by the
// get_my_overview AI Assist tool (chat) and the GET /api/ai-assist/overview REST
// endpoint (instant role-aware cards, no LLM call).

const MAX_PORTFOLIO_STUDENTS = 600;
const DEFAULT_DEADLINE_WINDOW_DAYS = 30;
// Small sample for the chat tool (get_my_overview) — keeps the LLM context lean.
const SAMPLE_SIZE = 8;
// Larger cap for the REST portfolio view, which needs the full at-risk list to
// triage rather than a handful of examples. Still bounded to avoid huge payloads.
const PORTFOLIO_BUCKET_LIMIT = 200;
// Thresholds for the behaviour-based (not status-based) risk signals. These
// surface the "who has gone quiet / what is stuck" questions that pure status
// fields cannot answer.
const THREAD_STALL_DAYS = 7;

const OVERVIEW_STUDENT_FIELDS =
  'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors profile applying_program_count createdAt';
const OVERVIEW_APPLICATION_FIELDS =
  'programId studentId admission decided closed finalEnrolment application_year uni_assist admission_letter';
const OVERVIEW_APPLICATION_POPULATE = {
  path: 'programId',
  select: 'school program_name degree semester application_deadline country'
};

const toIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.toString?.() || '';
};

const safeDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isTruthyFlag = (value) => value === true || value === 'O' || value === 'Y';

// Convert the deadline string from application_deadline_V2_calculator
// ("YYYY/MM/DD", "YYYY-Rolling", "WITHDRAW", "No Data") into a usable shape.
const parseDeadline = (deadlineString) => {
  if (!deadlineString || typeof deadlineString !== 'string') {
    return { date: null, rolling: false, label: 'unknown' };
  }
  if (deadlineString.toLowerCase().includes('rolling')) {
    return { date: null, rolling: true, label: deadlineString };
  }
  const parts = deadlineString.split('/');
  if (parts.length !== 3) {
    return { date: null, rolling: false, label: deadlineString };
  }
  const [year, month, day] = parts.map((part) => parseInt(part, 10));
  if (!year || !month || !day) {
    return { date: null, rolling: false, label: deadlineString };
  }
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime())
    ? { date: null, rolling: false, label: deadlineString }
    : { date, rolling: false, label: deadlineString };
};

const deriveStatus = (application = {}) => {
  if (isTruthyFlag(application.finalEnrolment)) return 'final_enrolled';
  if (application.admission === 'O') return 'admitted';
  if (application.admission === 'X' || application.reject_reason)
    return 'rejected';
  if (isTruthyFlag(application.closed)) return 'closed';
  return 'in_progress';
};

const loadPortfolio = async (req, { maxStudents = MAX_PORTFOLIO_STUDENTS } = {}) => {
  const filter = await getAccessibleStudentFilter(req);
  const students = await StudentService.findStudentsSelect(
    filter,
    OVERVIEW_STUDENT_FIELDS,
    maxStudents
  );

  const studentById = new Map();
  students.forEach((student) => {
    studentById.set(toIdString(student._id || student.id), student);
  });
  const studentIds = Array.from(studentById.keys());

  if (!studentIds.length) {
    return { students, studentById, studentIds, applications: [], threads: [] };
  }

  const studentObjectIds = students.map((s) => s._id || s.id).filter(Boolean);

  const [applications, threads] = await Promise.all([
    ApplicationService.findApplicationsSelectPopulate(
      { studentId: { $in: studentIds } },
      OVERVIEW_APPLICATION_FIELDS,
      OVERVIEW_APPLICATION_POPULATE
    ),
    DocumentThreadService.getThreadsWaitingOnTeam(studentObjectIds)
  ]);

  return { students, studentById, studentIds, applications, threads };
};

const studentLabel = (student) => {
  const normalized = normalizeUser(student);
  return {
    id: normalized?.id,
    name: normalized?.name,
    chineseName: normalized?.chineseName,
    email: normalized?.email,
    joinedAt: student.createdAt ?? null,
    applyingProgramCount: student.applying_program_count ?? 0,
    hasEditors: Array.isArray(student.editors) && student.editors.length > 0
  };
};

const buildFinalizedStudentIds = (applications): Set<string> => {
  const ids = new Set<string>();
  (applications || []).forEach((app) => {
    if (isTruthyFlag(app.finalEnrolment)) ids.add(toIdString(app.studentId));
  });
  return ids;
};

// Applications with a real (non-rolling) deadline within `days`, still in
// progress (not closed/admitted/rejected). Sorted soonest-first.
// Items for students who confirmed enrolment elsewhere are flagged confirmedElsewhere.
const collectUpcomingDeadlines = (applications, studentById, days, finalizedStudentIds: Set<string>) => {
  const today = new Date();
  const items = [];

  (applications || []).forEach((application) => {
    if (deriveStatus(application) !== 'in_progress') return;
    const { date, rolling, label } = parseDeadline(
      application_deadline_V2_calculator(application)
    );
    if (rolling || !date) return;

    const daysUntil = differenceInDays(date, today);
    if (daysUntil < 0 || daysUntil > days) return;

    const studentId = toIdString(application.studentId);
    const student = studentById.get(studentId);
    items.push({
      student: student ? studentLabel(student) : { id: studentId },
      program: application.programId
        ? {
            school: application.programId.school,
            name:
              application.programId.program_name ||
              application.programId.name
          }
        : null,
      deadline: label,
      daysUntil,
      ...(finalizedStudentIds.has(studentId) ? { confirmedElsewhere: true } : {})
    });
  });

  return items.sort((a, b) => a.daysUntil - b.daysUntil);
};

const collectAdmittedNotConfirmed = (applications, studentById) =>
  (applications || [])
    .filter(
      (application) =>
        application.admission === 'O' &&
        !isTruthyFlag(application.finalEnrolment)
    )
    .map((application) => {
      const student = studentById.get(toIdString(application.studentId));
      return {
        student: student ? studentLabel(student) : { id: toIdString(application.studentId) },
        program: application.programId
          ? {
              school: application.programId.school,
              name:
                application.programId.program_name ||
                application.programId.name
            }
          : null
      };
    });

// threads here are already pre-filtered by the aggregation (student sent last
// message, not ignored). stalledDays < 3 are skipped (too fresh to surface).
// Items for students who confirmed enrolment elsewhere are flagged confirmedElsewhere.
const collectThreadsWaitingOnTeam = (threads, studentById, finalizedStudentIds: Set<string>) => {
  const today = new Date();
  const items = (threads || []).map((thread) => {
    const studentId = toIdString(thread.student_id);
    const student = studentById.get(studentId);
    const lastMsgDate = safeDate(thread.lastMsgAt);
    const stalledDays = lastMsgDate
      ? Math.max(differenceInDays(today, lastMsgDate), 0)
      : 0;
    return {
      student: student ? studentLabel(student) : { id: studentId },
      fileType: thread.file_type,
      stalledDays,
      ...(finalizedStudentIds.has(studentId) ? { confirmedElsewhere: true } : {})
    };
  }).filter((item) => item.stalledDays >= 3);

  return items.sort((a, b) => b.stalledDays - a.stalledDays);
};

// Students with at least one in-progress application whose latest message was
// sent by the student themselves and has not been marked "no reply needed".
// Urgency: ≥14d → critical, ≥7d → high, ≥3d → medium.
const collectCommunicationGaps = (
  studentById,
  applications,
  unansweredRows  // [{ _id: ObjectId, latestAt: Date }]
) => {
  const today = new Date();
  const activeStudentIds = new Set(
    (applications || [])
      .filter((application) => deriveStatus(application) === 'in_progress')
      .map((application) => toIdString(application.studentId))
  );

  const items = [];
  (unansweredRows || []).forEach((row) => {
    const id = toIdString(row._id);
    if (!activeStudentIds.has(id)) return;
    const student = studentById.get(id);
    if (!student) return;
    const latestAt = safeDate(row.latestAt);
    const daysSince = latestAt
      ? Math.max(differenceInDays(today, latestAt), 0)
      : 0;
    if (daysSince < 3) return;
    items.push({ student: studentLabel(student), lastContactDays: daysSince });
  });

  return items.sort((a, b) => b.lastContactDays - a.lastContactDays);
};

const collectMissingBaseDocuments = (students) => {
  const items = [];
  (students || []).forEach((student) => {
    const missing = (student.profile || []).filter(
      (document) => document.required && !document.path
    );
    if (missing.length) {
      items.push({
        student: studentLabel(student),
        missingDocuments: missing.map((document) => document.name)
      });
    }
  });
  return items;
};

const bucket = (items, sampleSize = SAMPLE_SIZE) => ({
  // `count` is always the true total; `items` is a capped slice. The portfolio
  // view passes a large sampleSize so the at-risk list is not silently truncated.
  count: items.length,
  items: items.slice(0, sampleSize)
});

const buildStudentStats = (
  applications: { studentId?: unknown; admission?: string }[]
): Record<string, { offerCount: number; rejectCount: number }> => {
  const stats: Record<string, { offerCount: number; rejectCount: number }> = {};
  (applications || []).forEach((app) => {
    const id = toIdString(app.studentId);
    if (!id) return;
    if (!stats[id]) stats[id] = { offerCount: 0, rejectCount: 0 };
    if (app.admission === 'O') stats[id].offerCount++;
    if (app.admission === 'X') stats[id].rejectCount++;
  });
  return stats;
};

const buildStudentTerms = (
  applications: { studentId?: unknown; application_year?: string | number; programId?: { semester?: string } }[]
): Record<string, string[]> => {
  const termsById: Record<string, Set<string>> = {};
  (applications || []).forEach((app) => {
    const id = toIdString(app.studentId);
    if (!id) return;
    const semester = app.programId?.semester;
    const year = app.application_year;
    if (!semester || !year) return;
    const term = `${semester}${year}`;
    if (!termsById[id]) termsById[id] = new Set();
    termsById[id].add(term);
  });
  return Object.fromEntries(
    Object.entries(termsById).map(([id, set]) => [id, Array.from(set).sort()])
  );
};

const enrichBucketItems = (
  bucketObj: { count: number; items: { student?: { id?: string } & Record<string, unknown> }[] },
  statsById: Record<string, { offerCount: number; rejectCount: number }>,
  termsById: Record<string, string[]> = {}
) => ({
  count: bucketObj.count,
  items: bucketObj.items.map((item) =>
    item.student?.id
      ? {
          ...item,
          student: {
            ...item.student,
            ...(statsById[item.student.id] ?? { offerCount: 0, rejectCount: 0 }),
            applicationTerms: termsById[item.student.id] ?? []
          }
        }
      : item
  )
});

const buildOverview = async (
  req,
  { deadlineWindowDays, sampleSize = SAMPLE_SIZE } = {}
) => {
  const role = req?.user?.role;
  const days = deadlineWindowDays || DEFAULT_DEADLINE_WINDOW_DAYS;
  const { students, studentById, applications, threads } =
    await loadPortfolio(req);

  // Unanswered student messages (single aggregation) — students whose last
  // message came from themselves and is not marked "no reply needed".
  // Best-effort: a failure here must not break the rest of the overview.
  let unansweredRows = [];
  try {
    const studentObjectIds = (students || [])
      .map((student) => student._id || student.id)
      .filter(Boolean);
    unansweredRows =
      await CommunicationService.getUnansweredStudentMessages(studentObjectIds);
  } catch {
    // Leave empty; communicationGaps will be empty.
  }

  const statsById = buildStudentStats(applications);
  const termsById = buildStudentTerms(applications);
  const finalizedStudentIds = buildFinalizedStudentIds(applications);

  const upcomingDeadlines = collectUpcomingDeadlines(
    applications,
    studentById,
    days,
    finalizedStudentIds
  );
  const admittedNotConfirmed = collectAdmittedNotConfirmed(
    applications,
    studentById
  );
  const threadsWaitingOnTeam = collectThreadsWaitingOnTeam(threads, studentById, finalizedStudentIds);
  const missingBaseDocuments = collectMissingBaseDocuments(students);
  const communicationGaps = collectCommunicationGaps(
    studentById,
    applications,
    unansweredRows
  );

  // Role-aware emphasis: which buckets matter most for this user.
  const emphasis =
    role === Role.Editor
      ? ['threadsWaitingOnTeam', 'communicationGaps', 'upcomingDeadlines']
      : role === Role.Manager
      ? [
          'upcomingDeadlines',
          'communicationGaps',
          'admittedNotConfirmed',
          'threadsWaitingOnTeam'
        ]
      : [
          'upcomingDeadlines',
          'communicationGaps',
          'missingBaseDocuments',
          'admittedNotConfirmed'
        ];

  return {
    role,
    studentCount: students.length,
    deadlineWindowDays: days,
    emphasis,
    buckets: {
      upcomingDeadlines: enrichBucketItems(bucket(upcomingDeadlines, sampleSize), statsById, termsById),
      threadsWaitingOnTeam: enrichBucketItems(bucket(threadsWaitingOnTeam, sampleSize), statsById, termsById),
      communicationGaps: enrichBucketItems(bucket(communicationGaps, sampleSize), statsById, termsById),
      admittedNotConfirmed: enrichBucketItems(bucket(admittedNotConfirmed, sampleSize), statsById, termsById),
      missingBaseDocuments: enrichBucketItems(bucket(missingBaseDocuments, sampleSize), statsById, termsById)
    }
  };
};

export = {
  buildOverview,
  loadPortfolio,
  collectUpcomingDeadlines,
  collectAdmittedNotConfirmed,
  collectMissingBaseDocuments,
  collectThreadsWaitingOnTeam,
  collectCommunicationGaps,
  parseDeadline,
  PORTFOLIO_BUCKET_LIMIT,
  buildFinalizedStudentIds,
  buildStudentStats,
  buildStudentTerms,
  enrichBucketItems,
  toIdString,
  safeDate,
  isTruthyFlag,
  deriveStatus,
  studentLabel
};
