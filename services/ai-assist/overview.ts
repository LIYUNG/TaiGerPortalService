import { differenceInDays } from 'date-fns';
import type { Request } from 'express';
import { Role } from '@taiger-common/core';

import { getAccessibleStudentFilter } from './studentAccess';
import { getSignalsForStudents } from './signalLedger';
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
const COMMUNICATION_GAP_DAYS = 7;

const OVERVIEW_STUDENT_FIELDS =
  'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors profile applying_program_count createdAt attributes';
const OVERVIEW_APPLICATION_FIELDS =
  'programId studentId admission decided closed finalEnrolment application_year uni_assist admission_letter';
const OVERVIEW_APPLICATION_POPULATE = {
  path: 'programId',
  select: 'school program_name degree semester application_deadline country'
};

// These services return mongoose lean documents with a hand-picked field
// selection and a populated `programId`, so the exact @taiger-common model
// interfaces do not apply. Loose structural shapes describe the fields actually
// read here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OverviewStudent = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OverviewApplication = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OverviewThread = Record<string, any>;

const toIdString = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return (value as { toString?: () => string }).toString?.() || '';
};

const safeDate = (value: unknown) => {
  if (!value) return null;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isTruthyFlag = (value: unknown) =>
  value === true || value === 'O' || value === 'Y';

// Convert the deadline string from application_deadline_V2_calculator
// ("YYYY/MM/DD", "YYYY-Rolling", "WITHDRAW", "No Data") into a usable shape.
const parseDeadline = (deadlineString: string) => {
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

const deriveStatus = (application: OverviewApplication = {}) => {
  if (isTruthyFlag(application.finalEnrolment)) return 'final_enrolled';
  if (application.admission === 'O') return 'admitted';
  if (application.admission === 'X' || application.reject_reason)
    return 'rejected';
  if (isTruthyFlag(application.closed)) return 'closed';
  return 'in_progress';
};

const loadPortfolio = async (
  req: Request,
  { maxStudents = MAX_PORTFOLIO_STUDENTS }: { maxStudents?: number } = {}
) => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DocumentThreadService.getThreadsWaitingOnTeam(studentObjectIds as any)
  ]);

  return { students, studentById, studentIds, applications, threads };
};

const studentLabel = (student: OverviewStudent) => {
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

const buildFinalizedStudentIds = (
  applications: OverviewApplication[]
): Set<string> => {
  const ids = new Set<string>();
  (applications || []).forEach((app) => {
    if (isTruthyFlag(app.finalEnrolment)) ids.add(toIdString(app.studentId));
  });
  return ids;
};

// Applications with a real (non-rolling) deadline within `days`, still in
// progress (not closed/admitted/rejected). Sorted soonest-first.
// Items for students who confirmed enrolment elsewhere are flagged confirmedElsewhere.
const collectUpcomingDeadlines = (
  applications: OverviewApplication[],
  studentById: Map<string, OverviewStudent>,
  days: number,
  finalizedStudentIds: Set<string> = new Set()
) => {
  const today = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];

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
              application.programId.program_name || application.programId.name
          }
        : null,
      deadline: label,
      daysUntil,
      ...(finalizedStudentIds.has(studentId)
        ? { confirmedElsewhere: true }
        : {})
    });
  });

  return items.sort((a, b) => a.daysUntil - b.daysUntil);
};

const collectAdmittedNotConfirmed = (
  applications: OverviewApplication[],
  studentById: Map<string, OverviewStudent>
) =>
  (applications || [])
    .filter(
      (application) =>
        application.admission === 'O' &&
        !isTruthyFlag(application.finalEnrolment)
    )
    .map((application) => {
      const student = studentById.get(toIdString(application.studentId));
      return {
        student: student
          ? studentLabel(student)
          : { id: toIdString(application.studentId) },
        program: application.programId
          ? {
              school: application.programId.school,
              name:
                application.programId.program_name || application.programId.name
            }
          : null
      };
    });

// threads here are already pre-filtered by the aggregation (student sent last
// message, not ignored). stalledDays < 3 are skipped (too fresh to surface).
// Items for students who confirmed enrolment elsewhere are flagged confirmedElsewhere.
const collectThreadsWaitingOnTeam = (
  threads: OverviewThread[],
  studentById: Map<string, OverviewStudent>,
  finalizedStudentIds: Set<string> = new Set()
) => {
  const today = new Date();
  const items = (threads || [])
    .filter(
      (thread) =>
        !thread.isFinalVersion &&
        toIdString(thread.latest_message_left_by_id) ===
          toIdString(thread.student_id)
    )
    .map((thread) => {
      const studentId = toIdString(thread.student_id);
      const student = studentById.get(studentId);
      const lastMsgDate = safeDate(thread.lastMsgAt ?? thread.updatedAt);
      const stalledDays = lastMsgDate
        ? Math.max(differenceInDays(today, lastMsgDate), 0)
        : 0;
      return {
        student: student ? studentLabel(student) : { id: studentId },
        fileType: thread.file_type,
        stalledDays,
        ...(finalizedStudentIds.has(studentId)
          ? { confirmedElsewhere: true }
          : {})
      };
    })
    .filter((item) => item.stalledDays >= 3);

  return items.sort((a, b) => b.stalledDays - a.stalledDays);
};

// Students with at least one in-progress application whose latest message was
// sent by the student themselves and has not been marked "no reply needed".
// Urgency: ≥14d → critical, ≥7d → high, ≥3d → medium.
const collectCommunicationGaps = (
  students: OverviewStudent[],
  applications: OverviewApplication[],
  latestMessageAtById: Map<string, Date> // studentId -> latest message date
) => {
  const today = new Date();
  const activeStudentIds = new Set(
    (applications || [])
      .filter((application) => deriveStatus(application) === 'in_progress')
      .map((application) => toIdString(application.studentId))
  );

  const studentById = new Map<string, OverviewStudent>();
  (students || []).forEach((s) => {
    studentById.set(toIdString(s._id || s.id), s);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];
  activeStudentIds.forEach((id) => {
    const student = studentById.get(id);
    if (!student) return;
    const latestAt = latestMessageAtById.get(id) ?? null;
    const daysSince = latestAt
      ? Math.max(differenceInDays(today, latestAt), 0)
      : null;
    if (daysSince !== null && daysSince < COMMUNICATION_GAP_DAYS) return;
    items.push({ student: studentLabel(student), lastContactDays: daysSince });
  });

  return items.sort(
    (a, b) => (b.lastContactDays ?? Infinity) - (a.lastContactDays ?? Infinity)
  );
};

const SIGNAL_SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3 };

// A student is "Done" when carrying the Done attribute (value 8) or has
// confirmed enrolment — implicit comms risk for them is no longer actionable,
// so it is capped to "low".
const hasDoneAttribute = (student) =>
  (student?.attributes || []).some(
    (attribute) => String(attribute?.name).toLowerCase() === 'done'
  );

// Sortable term value: lower = sooner. Summer semester precedes winter within a
// year. Students with no parseable term sort last (Infinity).
const soonestTermValue = (applications) => {
  let soonest = Infinity;
  (applications || []).forEach((app) => {
    const year = parseInt(String(app.application_year), 10);
    if (!year) return;
    const semester = String(app.programId?.semester || '').toLowerCase();
    const isSummer =
      semester.includes('sommer') ||
      semester.includes('summer') ||
      semester.includes('spring') ||
      semester === 'ss' ||
      semester.startsWith('s');
    const value = year * 2 + (isSummer ? 0 : 1);
    if (value < soonest) soonest = value;
  });
  return soonest;
};

// Content-derived implicit risk signals (from the signal ledger), joined to the
// students in this portfolio. Sorted most-severe first; within the same risk
// level, the student whose nearest application term (year + semester) is sooner
// comes first. Unresolved signals only; "Done" students capped to low.
const collectCommunicationRiskSignals = (
  studentById,
  signalsById,
  applicationsByStudentId
) => {
  const items = [];
  signalsById.forEach((row, studentId) => {
    const student = studentById.get(studentId);
    if (!student) return;
    const signals = (row.signals || []).filter((signal) => !signal.resolved);
    if (!signals.length) return;

    const riskLevel =
      hasDoneAttribute(student) &&
      (SIGNAL_SEVERITY_RANK[row.riskLevel] || 0) > SIGNAL_SEVERITY_RANK.low
        ? 'low'
        : row.riskLevel;

    items.push({
      student: studentLabel(student),
      riskLevel,
      termValue: soonestTermValue(applicationsByStudentId.get(studentId)),
      lastMessageAt: row.lastMessageAt ?? null,
      signals: signals.map((signal) => ({
        type: signal.type,
        severity: signal.severity,
        summaryEn: signal.summaryEn,
        summaryZh: signal.summaryZh,
        evidence: signal.evidence,
        occurredAt: signal.occurredAt ?? null,
        sourceMessageId: signal.sourceMessageId ?? null,
        sinceDays: (signal.occurredAt || signal.firstSeenAt)
          ? Math.max(
              differenceInDays(
                new Date(),
                new Date(signal.occurredAt || signal.firstSeenAt)
              ),
              0
            )
          : null
      }))
    });
  });

  return items.sort((a, b) => {
    const bySeverity =
      (SIGNAL_SEVERITY_RANK[b.riskLevel] || 0) -
      (SIGNAL_SEVERITY_RANK[a.riskLevel] || 0);
    if (bySeverity !== 0) return bySeverity;
    return a.termValue - b.termValue; // sooner term first
  });
};

const collectMissingBaseDocuments = (students: OverviewStudent[]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];
  (students || []).forEach((student) => {
    const missing = (student.profile || []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document: any) => document.required && !document.path
    );
    if (missing.length) {
      items.push({
        student: studentLabel(student),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        missingDocuments: missing.map((document: any) => document.name)
      });
    }
  });
  return items;
};

const bucket = <T>(items: T[], sampleSize = SAMPLE_SIZE) => ({
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
  applications: {
    studentId?: unknown;
    application_year?: string | number;
    programId?: { semester?: string };
  }[]
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
  bucketObj: {
    count: number;
    items: { student?: { id?: string } & Record<string, unknown> }[];
  },
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
            ...(statsById[item.student.id] ?? {
              offerCount: 0,
              rejectCount: 0
            }),
            applicationTerms: termsById[item.student.id] ?? []
          }
        }
      : item
  )
});

const buildOverview = async (
  req: Request,
  {
    deadlineWindowDays,
    sampleSize = SAMPLE_SIZE
  }: { deadlineWindowDays?: number; sampleSize?: number } = {}
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (req?.user as any)?.role;
  const days = deadlineWindowDays || DEFAULT_DEADLINE_WINDOW_DAYS;
  const { students, studentById, applications, threads } = await loadPortfolio(
    req
  );

  // Latest message dates per student — used to surface students who have gone
  // quiet. Best-effort: a failure here must not break the rest of the overview.
  const latestMessageAtById = new Map<string, Date>();
  try {
    const studentObjectIds = (students || [])
      .map((student) => student._id || student.id)
      .filter(Boolean);
    const rows = await CommunicationService.getLatestMessageAtForStudents(
      studentObjectIds
    );
    (rows || []).forEach((row: any) => {
      const id = toIdString(row._id ?? row.studentId);
      const date = safeDate(row.latestAt);
      if (id && date) latestMessageAtById.set(id, date);
    });
  } catch {
    // Leave empty; communicationGaps will reflect no contact data.
  }

  // Content-derived implicit risk signals from the ledger. Best-effort: a
  // failure (or an empty/never-run ledger) must not break the rest.
  let signalsById = new Map<string, any>();
  try {
    signalsById = await getSignalsForStudents(Array.from(studentById.keys()));
  } catch {
    // Leave empty; the communicationRiskSignals bucket will simply be empty.
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
  const threadsWaitingOnTeam = collectThreadsWaitingOnTeam(
    threads,
    studentById,
    finalizedStudentIds
  );
  const missingBaseDocuments = collectMissingBaseDocuments(students);
  const communicationGaps = collectCommunicationGaps(
    students,
    applications,
    latestMessageAtById
  );
  const applicationsByStudentId = new Map();
  (applications || []).forEach((app) => {
    const id = toIdString(app.studentId);
    if (!id) return;
    if (!applicationsByStudentId.has(id)) applicationsByStudentId.set(id, []);
    applicationsByStudentId.get(id).push(app);
  });
  const communicationRiskSignals = collectCommunicationRiskSignals(
    studentById,
    signalsById,
    applicationsByStudentId
  );

  // Role-aware emphasis: which buckets matter most for this user.
  const emphasis =
    role === Role.Editor
      ? [
          'threadsWaitingOnTeam',
          'communicationRiskSignals',
          'communicationGaps',
          'upcomingDeadlines'
        ]
      : role === Role.Manager
      ? [
          'communicationRiskSignals',
          'upcomingDeadlines',
          'communicationGaps',
          'admittedNotConfirmed',
          'threadsWaitingOnTeam'
        ]
      : [
          'upcomingDeadlines',
          'communicationRiskSignals',
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
      communicationRiskSignals: enrichBucketItems(bucket(communicationRiskSignals, sampleSize), statsById, termsById),
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
