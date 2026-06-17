import { differenceInDays } from 'date-fns';
import { Role } from '@taiger-common/core';

import { getAccessibleStudentFilter } from './studentAccess';
import { normalizeUser } from './normalizers';
import { application_deadline_V2_calculator } from '../../constants';
import StudentService from '../students';
import ApplicationService from '../applications';
import DocumentThreadService from '../documentthreads';

// Cross-portfolio "what needs my attention" aggregation. Shared by the
// get_my_overview AI Assist tool (chat) and the GET /api/ai-assist/overview REST
// endpoint (instant role-aware cards, no LLM call).

const MAX_PORTFOLIO_STUDENTS = 600;
const DEFAULT_DEADLINE_WINDOW_DAYS = 30;
const SAMPLE_SIZE = 8;

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

const collectThreadsWaitingOnTeam = (threads, studentById) =>
  (threads || [])
    .filter((thread) => {
      if (thread.isFinalVersion) return false;
      const latestBy = toIdString(thread.latest_message_left_by_id);
      const studentId = toIdString(thread.student_id);
      // Pending on the team when the latest message came from the student.
      return latestBy && studentId && latestBy === studentId;
    })
    .map((thread) => {
      const student = studentById.get(toIdString(thread.student_id));
      return {
        student: student ? studentLabel(student) : { id: toIdString(thread.student_id) },
        fileType: thread.file_type,
        updatedAt: thread.updatedAt
      };
    });

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

const bucket = (items) => ({
  count: items.length,
  items: items.slice(0, SAMPLE_SIZE)
});

const buildOverview = async (req, { deadlineWindowDays } = {}) => {
  const role = req?.user?.role;
  const days = deadlineWindowDays || DEFAULT_DEADLINE_WINDOW_DAYS;
  const { students, studentById, applications, threads } =
    await loadPortfolio(req);

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

  // Role-aware emphasis: which buckets matter most for this user.
  const emphasis =
    role === Role.Editor
      ? ['threadsWaitingOnTeam', 'upcomingDeadlines']
      : role === Role.Manager
      ? ['upcomingDeadlines', 'admittedNotConfirmed', 'threadsWaitingOnTeam']
      : ['upcomingDeadlines', 'missingBaseDocuments', 'admittedNotConfirmed'];

  return {
    role,
    studentCount: students.length,
    deadlineWindowDays: days,
    emphasis,
    buckets: {
      upcomingDeadlines: bucket(upcomingDeadlines),
      threadsWaitingOnTeam: bucket(threadsWaitingOnTeam),
      admittedNotConfirmed: bucket(admittedNotConfirmed),
      missingBaseDocuments: bucket(missingBaseDocuments)
    }
  };
};

export = {
  buildOverview,
  loadPortfolio,
  collectUpcomingDeadlines,
  parseDeadline
};
