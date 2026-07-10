import { differenceInDays } from 'date-fns';
import type { Types } from 'mongoose';
import { Role } from '@taiger-common/core';

import type { AuthenticatedUser } from '../../types/express';

// `studentAccess`, `signalLedger` and `normalizers` are exported via `export =`
// (CommonJS-style), so they must be imported as a default (esModuleInterop)
// rather than destructured as named ES exports.
import studentAccess from './studentAccess';
import signalLedger from './signalLedger';
import type { StudentCommunicationSignal } from '../../drizzle/schema/schema';
import normalizers from './normalizers';
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
// interfaces do not apply. The structural shapes below describe just the fields
// actually read here; reference-ish fields are left `unknown` and coerced via
// the toIdString/safeDate/isTruthyFlag helpers.
interface OverviewProgram {
  school?: string;
  program_name?: string;
  name?: string;
  degree?: string;
  semester?: string;
  application_deadline?: string;
  country?: string;
}
interface OverviewStudent {
  _id?: { toString?: () => string } | string | null;
  id?: string;
  firstname?: string | null;
  lastname?: string | null;
  firstname_chinese?: string | null;
  lastname_chinese?: string | null;
  email?: string | null;
  role?: string;
  archiv?: boolean;
  createdAt?: Date;
  applying_program_count?: number;
  editors?: unknown[];
  attributes?: { name?: string; value?: number }[];
  profile?: { name?: string; required?: boolean; path?: string }[];
}
interface OverviewApplication {
  _id?: { toString?: () => string } | string | null;
  id?: string;
  studentId?: unknown;
  programId?: OverviewProgram | null;
  admission?: string;
  decided?: string;
  closed?: unknown;
  finalEnrolment?: unknown;
  reject_reason?: string;
  application_year?: string | number;
  admission_letter?: unknown;
  uni_assist?: unknown;
}
interface OverviewThread {
  isFinalVersion?: boolean;
  latest_message_left_by_id?: unknown;
  student_id?: unknown;
  lastMsgAt?: unknown;
  updatedAt?: unknown;
  file_type?: string;
}

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
  req: { user?: unknown },
  { maxStudents = MAX_PORTFOLIO_STUDENTS }: { maxStudents?: number } = {}
) => {
  const filter = await studentAccess.getAccessibleStudentFilter(req);
  // Lean mongoose documents with a hand-picked field selection — see the
  // OverviewStudent comment above for why the loose Record shape is used.
  const students = (await StudentService.findStudentsSelect(
    filter,
    OVERVIEW_STUDENT_FIELDS,
    maxStudents
  )) as unknown as OverviewStudent[];

  const studentById = new Map<string, OverviewStudent>();
  students.forEach((student) => {
    studentById.set(toIdString(student._id || student.id), student);
  });
  const studentIds = Array.from(studentById.keys());

  if (!studentIds.length) {
    return {
      students,
      studentById,
      studentIds,
      applications: [] as OverviewApplication[],
      threads: [] as OverviewThread[]
    };
  }

  const studentObjectIds = students.map((s) => s._id || s.id).filter(Boolean);

  const [applications, threads] = (await Promise.all([
    // Only committed, live applications: a program the student decided to apply
    // to (decided === 'O') and has not withdrawn (closed !== 'X'). Undecided and
    // withdrawn programs are excluded at the DB so nothing downstream surfaces
    // them — matching isProgramDecided / isProgramWithdraw from @taiger-common.
    ApplicationService.findApplicationsSelectPopulate(
      { studentId: { $in: studentIds }, decided: 'O', closed: { $ne: 'X' } },
      OVERVIEW_APPLICATION_FIELDS,
      OVERVIEW_APPLICATION_POPULATE
    ),
    DocumentThreadService.getThreadsWaitingOnTeam(
      studentObjectIds as unknown as string[]
    )
  ])) as unknown as [OverviewApplication[], OverviewThread[]];

  return { students, studentById, studentIds, applications, threads };
};

const studentLabel = (student: OverviewStudent) => {
  const normalized = normalizers.normalizeUser(student);
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

// The compact student descriptor emitted by studentLabel, plus the id-only
// fallback used when the student doc is not in the portfolio map.
type StudentLabel = ReturnType<typeof studentLabel>;
type StudentRef = StudentLabel | { id: string };
type ProgramRef = { school?: string; name?: string } | null;

interface UpcomingDeadlineItem {
  student: StudentRef;
  program: ProgramRef;
  deadline: string;
  daysUntil: number;
  confirmedElsewhere?: boolean;
}
interface AdmittedNotConfirmedItem {
  student: StudentRef;
  program: ProgramRef;
}
interface ThreadWaitingItem {
  student: StudentRef;
  fileType?: string;
  stalledDays: number;
  confirmedElsewhere?: boolean;
}
interface CommunicationGapItem {
  student: StudentLabel;
  lastContactDays: number | null;
}
interface MissingBaseDocumentsItem {
  student: StudentLabel;
  missingDocuments: (string | undefined)[];
}

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
  const items: UpcomingDeadlineItem[] = [];

  (applications || []).forEach((application) => {
    if (deriveStatus(application) !== 'in_progress') return;
    // application_deadline_V2_calculator wants the strict (unexported)
    // PopulatedApplication shape; this application is a lean/select-projected
    // document (see OverviewApplication above), but it carries the same
    // programId/application_year/closed fields the calculator actually reads.
    const { date, rolling, label } = parseDeadline(
      application_deadline_V2_calculator(
        application as unknown as Parameters<
          typeof application_deadline_V2_calculator
        >[0]
      )
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

  const items: CommunicationGapItem[] = [];
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

const SIGNAL_SEVERITY_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};

// A student is "Done" when carrying the Done attribute (value 8) or has
// confirmed enrolment — implicit comms risk for them is no longer actionable,
// so it is capped to "low".
const hasDoneAttribute = (student: OverviewStudent) =>
  (student?.attributes || []).some(
    (attribute: { name?: string }) =>
      String(attribute?.name).toLowerCase() === 'done'
  );

// Sortable term value: lower = sooner. Summer semester precedes winter within a
// year. Students with no parseable term sort last (Infinity).
const soonestTermValue = (applications: OverviewApplication[] = []) => {
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
// One item per student carrying an unresolved communication risk signal.
type CommunicationRiskSignalItem = {
  student: ReturnType<typeof studentLabel>;
  riskLevel: string;
  termValue: number;
  lastMessageAt: Date | null;
  signals: {
    type: string;
    severity: string;
    summaryEn: string;
    summaryZh: string;
    evidence: string;
    occurredAt: string | null;
    sourceMessageId: string | null;
    sinceDays: number | null;
  }[];
};

const collectCommunicationRiskSignals = (
  studentById: Map<string, OverviewStudent>,
  signalsById: Map<string, StudentCommunicationSignal>,
  applicationsByStudentId: Map<string, OverviewApplication[]>
) => {
  const items: CommunicationRiskSignalItem[] = [];
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
        sinceDays:
          signal.occurredAt || signal.firstSeenAt
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
  const items: MissingBaseDocumentsItem[] = [];
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

// Lower number = more urgent. Used to compute a student's overall urgency (the
// worst of their signals) and to sort students worst-first.
const URGENCY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2
};
const worstUrgency = (a: string, b: string) =>
  (URGENCY_RANK[a] ?? 99) <= (URGENCY_RANK[b] ?? 99) ? a : b;

const BUCKET_KEYS = [
  'upcomingDeadlines',
  'threadsWaitingOnTeam',
  'communicationGaps',
  'communicationRiskSignals',
  'admittedNotConfirmed',
  'missingBaseDocuments'
] as const;
type BucketKey = (typeof BUCKET_KEYS)[number];

interface Collected {
  upcomingDeadlines: UpcomingDeadlineItem[];
  threadsWaitingOnTeam: ThreadWaitingItem[];
  communicationGaps: CommunicationGapItem[];
  communicationRiskSignals: CommunicationRiskSignalItem[];
  admittedNotConfirmed: AdmittedNotConfirmedItem[];
  missingBaseDocuments: MissingBaseDocumentsItem[];
}
// A signal always carries its bucket tag + computed urgency; the remaining
// per-bucket payload fields (daysUntil, program, stalledDays, ...) vary by
// bucket and are read structurally by the frontend, hence the open record.
type Signal = { bucket: BucketKey; urgency: string } & Record<string, unknown>;
// Student-centric accumulator entry: the compact label fields (partial, since
// an id-only ref may be all that is known) plus the per-student aggregates.
type StudentEntry = Partial<StudentLabel> & {
  id?: string;
  offerCount: number;
  rejectCount: number;
  applicationTerms: string[];
  confirmedElsewhere: boolean;
  overallUrgency: string;
  signals: Signal[];
};

// Pre-group the per-bucket collector output into a student-centric view so the
// frontend renders directly without a cross-bucket join. Each student carries
// their signals (urgency computed here, not in the client) plus their
// offer/reject/term stats once — killing the per-item student duplication that
// the old bucket-of-items shape produced for at-risk students. Each signal
// carries its `bucket` tag, so any per-bucket count is derivable client-side.
const buildStudentsView = (
  collected: Collected,
  statsById: Record<string, { offerCount: number; rejectCount: number }>,
  termsById: Record<string, string[]>,
  finalizedStudentIds: Set<string>,
  limit: number
) => {
  const byId = new Map<string, StudentEntry>();
  const ensure = (label: StudentRef): StudentEntry => {
    // add() guarantees a truthy id before delegating here.
    const id = label.id as string;
    let entry = byId.get(id);
    if (!entry) {
      entry = {
        ...label,
        ...(statsById[id] ?? { offerCount: 0, rejectCount: 0 }),
        applicationTerms: termsById[id] ?? [],
        confirmedElsewhere: finalizedStudentIds.has(id),
        overallUrgency: 'medium',
        signals: [] as Signal[]
      };
      byId.set(id, entry);
    }
    return entry;
  };
  const add = (label: StudentRef, signal: Signal) => {
    if (!label?.id) return;
    const entry = ensure(label);
    entry.signals.push(signal);
    entry.overallUrgency = worstUrgency(entry.overallUrgency, signal.urgency);
  };

  collected.upcomingDeadlines.forEach((it) =>
    add(it.student, {
      bucket: 'upcomingDeadlines',
      urgency: it.confirmedElsewhere
        ? 'medium'
        : it.daysUntil < 7
        ? 'critical'
        : 'high',
      daysUntil: it.daysUntil,
      deadline: it.deadline,
      program: it.program ?? null
    })
  );
  collected.threadsWaitingOnTeam.forEach((it) =>
    add(it.student, {
      bucket: 'threadsWaitingOnTeam',
      urgency: it.confirmedElsewhere
        ? 'medium'
        : it.stalledDays >= 14
        ? 'critical'
        : it.stalledDays >= 7
        ? 'high'
        : 'medium',
      stalledDays: it.stalledDays,
      fileType: it.fileType ?? null
    })
  );
  collected.communicationGaps.forEach((it) => {
    const days = it.lastContactDays ?? 0;
    add(it.student, {
      bucket: 'communicationGaps',
      urgency: days >= 14 ? 'critical' : days >= 7 ? 'high' : 'medium',
      lastContactDays: it.lastContactDays ?? null
    });
  });
  collected.communicationRiskSignals.forEach((it) =>
    add(it.student, {
      bucket: 'communicationRiskSignals',
      urgency:
        (it.signals || []).some(
          (s: { severity?: string }) => s.severity === 'high'
        ) || it.riskLevel === 'high'
          ? 'high'
          : 'medium',
      riskLevel: it.riskLevel,
      riskSignals: it.signals ?? []
    })
  );
  collected.admittedNotConfirmed.forEach((it) =>
    add(it.student, {
      bucket: 'admittedNotConfirmed',
      urgency: 'medium',
      program: it.program ?? null
    })
  );
  collected.missingBaseDocuments.forEach((it) =>
    add(it.student, {
      bucket: 'missingBaseDocuments',
      urgency: 'medium',
      missingDocuments: it.missingDocuments ?? []
    })
  );

  const sorted = Array.from(byId.values()).sort(
    (a, b) =>
      (URGENCY_RANK[a.overallUrgency] ?? 99) -
      (URGENCY_RANK[b.overallUrgency] ?? 99)
  );
  const students = sorted.slice(0, limit);

  return { students, hasMoreStudents: sorted.length > students.length };
};

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
    programId?: { semester?: string } | null;
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

const buildOverview = async (
  req: { user?: unknown },
  {
    deadlineWindowDays,
    sampleSize = SAMPLE_SIZE
  }: { deadlineWindowDays?: number; sampleSize?: number } = {}
) => {
  const role = (req.user as AuthenticatedUser | undefined)?.role;
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
      studentObjectIds as unknown as Types.ObjectId[]
    );
    (rows || []).forEach(
      (row: { _id?: unknown; studentId?: unknown; latestAt?: unknown }) => {
        const id = toIdString(row._id ?? row.studentId);
        const date = safeDate(row.latestAt);
        if (id && date) latestMessageAtById.set(id, date);
      }
    );
  } catch {
    // Leave empty; communicationGaps will reflect no contact data.
  }

  // Content-derived implicit risk signals from the ledger. Best-effort: a
  // failure (or an empty/never-run ledger) must not break the rest.
  let signalsById = new Map<string, StudentCommunicationSignal>();
  try {
    signalsById = await signalLedger.getSignalsForStudents(
      Array.from(studentById.keys())
    );
  } catch {
    // Leave empty; the communicationRiskSignals bucket will simply be empty.
  }

  // `applications` is already filtered to committed, live programs (decided,
  // not withdrawn) by loadPortfolio's DB query, so every aggregate below reflects
  // only those.
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
  const applicationsByStudentId = new Map<string, OverviewApplication[]>();
  (applications || []).forEach((app) => {
    const id = toIdString(app.studentId);
    if (!id) return;
    if (!applicationsByStudentId.has(id)) applicationsByStudentId.set(id, []);
    // Guaranteed present: just set above when missing.
    applicationsByStudentId.get(id)!.push(app);
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

  const { students: studentsView, hasMoreStudents } = buildStudentsView(
    {
      upcomingDeadlines,
      threadsWaitingOnTeam,
      communicationGaps,
      communicationRiskSignals,
      admittedNotConfirmed,
      missingBaseDocuments
    },
    statsById,
    termsById,
    finalizedStudentIds,
    sampleSize
  );

  return {
    role,
    studentCount: students.length,
    deadlineWindowDays: days,
    emphasis,
    hasMoreStudents,
    // Pre-grouped, worst-first, urgency computed server-side. Each signal is
    // tagged with its `bucket`, so the frontend localizes + renders directly and
    // can derive any per-bucket count itself.
    students: studentsView
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
  buildStudentsView,
  toIdString,
  safeDate,
  isTruthyFlag,
  deriveStatus,
  studentLabel
};
