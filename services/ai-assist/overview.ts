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
const COMMUNICATION_GAP_DAYS = 21;
const THREAD_STALL_DAYS = 7;

const OVERVIEW_STUDENT_FIELDS =
  'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors profile applying_program_count';
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

  const [applications, threads] = await Promise.all([
    ApplicationService.findApplicationsSelectPopulate(
      { studentId: { $in: studentIds } },
      OVERVIEW_APPLICATION_FIELDS,
      OVERVIEW_APPLICATION_POPULATE
    ),
    DocumentThreadService.findThreadsSelectSorted(
      { student_id: { $in: studentIds } },
      'file_type student_id isFinalVersion latest_message_left_by_id updatedAt',
      { updatedAt: -1 }
    )
  ]);

  return { students, studentById, studentIds, applications, threads };
};

const studentLabel = (student) => {
  const normalized = normalizeUser(student);
  return {
    id: normalized?.id,
    name: normalized?.name,
    chineseName: normalized?.chineseName,
    email: normalized?.email
  };
};

// Applications with a real (non-rolling) deadline within `days`, still in
// progress (not closed/admitted/rejected). Sorted soonest-first.
const collectUpcomingDeadlines = (applications, studentById, days) => {
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

    const student = studentById.get(toIdString(application.studentId));
    items.push({
      student: student ? studentLabel(student) : { id: toIdString(application.studentId) },
      program: application.programId
        ? {
            school: application.programId.school,
            name:
              application.programId.program_name ||
              application.programId.name
          }
        : null,
      deadline: label,
      daysUntil
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

const collectThreadsWaitingOnTeam = (threads, studentById) => {
  const today = new Date();
  return (threads || [])
    .filter((thread) => {
      if (thread.isFinalVersion) return false;
      const latestBy = toIdString(thread.latest_message_left_by_id);
      const studentId = toIdString(thread.student_id);
      // Pending on the team when the latest message came from the student.
      return latestBy && studentId && latestBy === studentId;
    })
    .map((thread) => {
      const student = studentById.get(toIdString(thread.student_id));
      const updatedDate = safeDate(thread.updatedAt);
      const stalledDays = updatedDate
        ? Math.max(differenceInDays(today, updatedDate), 0)
        : null;
      return {
        student: student ? studentLabel(student) : { id: toIdString(thread.student_id) },
        fileType: thread.file_type,
        updatedAt: thread.updatedAt,
        stalledDays
      };
    })
    // Most-stalled first so the capped sample surfaces the worst cases.
    .sort((a, b) => (b.stalledDays ?? 0) - (a.stalledDays ?? 0));
};

// Students with at least one in-progress application who have not exchanged any
// message in COMMUNICATION_GAP_DAYS (or have never been messaged). This is the
// "the student went quiet" signal — derived from real activity, not a status.
const collectCommunicationGaps = (
  students,
  applications,
  latestMessageAtById
) => {
  const today = new Date();
  const activeStudentIds = new Set(
    (applications || [])
      .filter((application) => deriveStatus(application) === 'in_progress')
      .map((application) => toIdString(application.studentId))
  );

  const items = [];
  (students || []).forEach((student) => {
    const id = toIdString(student._id || student.id);
    if (!activeStudentIds.has(id)) return;

    const latestAt = latestMessageAtById.get(id);
    const lastContactDays = latestAt
      ? Math.max(differenceInDays(today, latestAt), 0)
      : null;

    // Flag when silent past the threshold, or no message has ever been logged.
    if (lastContactDays === null || lastContactDays >= COMMUNICATION_GAP_DAYS) {
      items.push({
        student: studentLabel(student),
        lastContactDays
      });
    }
  });

  // Longest silence first (nulls — never contacted — sort to the top).
  return items.sort(
    (a, b) => (b.lastContactDays ?? Infinity) - (a.lastContactDays ?? Infinity)
  );
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

const buildOverview = async (
  req,
  { deadlineWindowDays, sampleSize = SAMPLE_SIZE } = {}
) => {
  const role = req?.user?.role;
  const days = deadlineWindowDays || DEFAULT_DEADLINE_WINDOW_DAYS;
  const { students, studentById, applications, threads } =
    await loadPortfolio(req);

  // Latest message timestamp per student (single aggregation) → communication
  // gaps. Best-effort: a failure here must not break the rest of the overview.
  const latestMessageAtById = new Map();
  try {
    const studentObjectIds = (students || [])
      .map((student) => student._id || student.id)
      .filter(Boolean);
    const latestRows =
      await CommunicationService.getLatestMessageAtForStudents(studentObjectIds);
    (latestRows || []).forEach((row) => {
      const date = safeDate(row?.latestAt);
      if (date) {
        latestMessageAtById.set(toIdString(row._id), date);
      }
    });
  } catch {
    // Leave the map empty; communicationGaps will simply be conservative.
  }

  const upcomingDeadlines = collectUpcomingDeadlines(
    applications,
    studentById,
    days
  );
  const admittedNotConfirmed = collectAdmittedNotConfirmed(
    applications,
    studentById
  );
  const threadsWaitingOnTeam = collectThreadsWaitingOnTeam(threads, studentById);
  const missingBaseDocuments = collectMissingBaseDocuments(students);
  const communicationGaps = collectCommunicationGaps(
    students,
    applications,
    latestMessageAtById
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
      upcomingDeadlines: bucket(upcomingDeadlines, sampleSize),
      threadsWaitingOnTeam: bucket(threadsWaitingOnTeam, sampleSize),
      communicationGaps: bucket(communicationGaps, sampleSize),
      admittedNotConfirmed: bucket(admittedNotConfirmed, sampleSize),
      missingBaseDocuments: bucket(missingBaseDocuments, sampleSize)
    }
  };
};

export = {
  buildOverview,
  loadPortfolio,
  collectUpcomingDeadlines,
  collectThreadsWaitingOnTeam,
  collectCommunicationGaps,
  parseDeadline,
  PORTFOLIO_BUCKET_LIMIT
};
