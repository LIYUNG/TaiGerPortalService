const { ErrorResponse } = require('../../common/errors');
const { Role } = require('@taiger-common/core');
const { and, desc, eq, not } = require('drizzle-orm');
const { getPostgresDb } = require('../../database');
const { leads } = require('../../drizzle/schema/leads');
const {
  meetingTranscripts
} = require('../../drizzle/schema/meetingTranscripts');
const { getAccessibleStudentFilter } = require('./studentAccess');
const {
  normalizeApplication,
  normalizeMessage,
  normalizeProfileDocument,
  normalizeUser
} = require('./normalizers');

const clampLimit = (value, fallback, max) =>
  Math.min(Math.max(Number(value) || fallback, 1), max);
const RECENT_COMMUNICATION_DAYS = 30;
const ALL_COMMUNICATION_MAX_LIMIT = 200;

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ACCESSIBLE_STUDENT_FIELDS =
  'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors profile applying_program_count';

const normalizeStudentPickerRow = (student) => ({
  ...normalizeUser(student),
  applyingProgramCount: student.applying_program_count,
  agents: (student.agents || []).map((agent) => agent.toString?.() || agent),
  editors: (student.editors || []).map(
    (editor) => editor.toString?.() || editor
  )
});

const normalizeAssignedTeamMember = (member) => {
  const normalized = normalizeUser(member);
  if (normalized?.id) {
    return normalized;
  }

  const id =
    typeof member === 'string'
      ? member
      : member?._id?.toString?.() || member?.id?.toString?.();

  return id ? { id } : undefined;
};

const normalizeProgram = (program) => {
  if (!program) {
    return undefined;
  }

  return {
    id: program._id?.toString?.() || program.id,
    school: program.school,
    name: program.program_name || program.programName || program.name,
    degree: program.degree,
    semester: program.semester,
    applicationDeadline: program.application_deadline,
    country: program.country
  };
};

const isTruthyFlag = (value) =>
  value === true || value === 'O' || value === 'Y';

const deriveApplicationStatus = (application = {}) => {
  if (isTruthyFlag(application.finalEnrolment)) {
    return 'final_enrolled';
  }

  if (application.admission === 'O') {
    return 'admitted';
  }

  if (application.admission === 'X' || application.reject_reason) {
    return 'rejected';
  }

  if (isTruthyFlag(application.closed)) {
    return 'closed';
  }

  return 'in_progress';
};

const deriveApplicationDecision = (application = {}, normalizedStatus) => {
  if (normalizedStatus === 'final_enrolled') {
    return 'final enrolment confirmed';
  }

  if (normalizedStatus === 'admitted') {
    return 'waiting for final enrolment decision';
  }

  if (normalizedStatus === 'rejected') {
    return application.reject_reason || 'application rejected';
  }

  if (normalizedStatus === 'closed') {
    return 'application closed';
  }

  return 'under review';
};

const deriveApplicationRisks = (application = {}, normalizedStatus) => {
  const risks = [];

  if (
    normalizedStatus === 'admitted' &&
    !isTruthyFlag(application.finalEnrolment)
  ) {
    risks.push('final enrolment not confirmed');
  }

  if (application.uni_assist?.status === 'not_started') {
    risks.push('uni-assist not started');
  }

  if (
    application.admission_letter &&
    !application.admission_letter.path &&
    application.admission === 'O'
  ) {
    risks.push('admission letter file missing');
  }

  return risks;
};

const deriveApplicationNextActions = (application = {}, normalizedStatus) => {
  const nextActions = [];

  if (
    normalizedStatus === 'admitted' &&
    !isTruthyFlag(application.finalEnrolment)
  ) {
    nextActions.push('confirm enrolment decision with student');
  }

  if (application.uni_assist?.status === 'not_started') {
    nextActions.push('start uni-assist process');
  }

  if (
    application.admission_letter &&
    !application.admission_letter.path &&
    application.admission === 'O'
  ) {
    nextActions.push('upload or verify admission letter');
  }

  return nextActions;
};

const normalizeApplicationContextItem = (application) => {
  const status = deriveApplicationStatus(application);
  const program = normalizeProgram(application.programId);

  return {
    id: application._id?.toString?.() || application.id,
    program,
    school: program?.school,
    country: program?.country,
    status,
    decision: deriveApplicationDecision(application, status),
    deadline: program?.applicationDeadline,
    risks: deriveApplicationRisks(application, status),
    nextActions: deriveApplicationNextActions(application, status)
  };
};

const toObjectIdString = (value) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.toString?.() || '';
};

const safeDate = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const extractThreadMessageText = (message = {}) =>
  message.message || message.text || message.content || message.body || '';

const extractThreadMessageCreatedAt = (message = {}) =>
  safeDate(message.createdAt) ||
  safeDate(message.updatedAt) ||
  safeDate(message.timestamp);

const extractThreadMessageAuthor = (message = {}) =>
  toObjectIdString(message.user_id) || toObjectIdString(message.userId) || '';

const normalizeThreadMessages = (messages = [], limit = 3) =>
  (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      text: extractThreadMessageText(message),
      createdAt: extractThreadMessageCreatedAt(message),
      authorId: extractThreadMessageAuthor(message)
    }))
    .filter((message) => message.text || message.createdAt || message.authorId)
    .sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return aTime - bTime;
    })
    .slice(-Math.max(limit, 1))
    .map((message) => ({
      text: message.text || '',
      createdAt: message.createdAt?.toISOString?.() || null,
      authorId: message.authorId || null
    }));

const resolvePendingOwner = ({ latestMessageBy, studentId }) => {
  if (!latestMessageBy) {
    return 'unknown';
  }

  return latestMessageBy === studentId ? 'team' : 'student';
};

const buildThreadRiskFlags = ({ isFinalVersion, latestMessageAt }) => {
  const risks = [];
  if (!isFinalVersion) {
    risks.push('not_finalized');
  }

  if (!latestMessageAt) {
    risks.push('no_recent_message');
  }

  return risks;
};

const assertLeadAccessForStudent = async (req, studentId, studentParam) => {
  const role = req?.user?.role;
  if (role === Role.Admin || role === Role.Manager) {
    return;
  }

  if (role !== Role.Agent && role !== Role.Editor) {
    throw new ErrorResponse(403, 'You are not allowed to view CRM lead data');
  }

  const student =
    studentParam ||
    (await req.db
      .model('Student')
      .findById(studentId)
      .select('agents editors')
      .lean());

  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  const userId = toObjectIdString(req?.user?._id);
  const isAssigned = [...(student.agents || []), ...(student.editors || [])]
    .map((id) => toObjectIdString(id))
    .includes(userId);

  if (!isAssigned) {
    throw new ErrorResponse(403, 'You are not allowed to view CRM lead data');
  }
};

const requireAccessibleStudent = async (req, studentId) => {
  const filter = await getAccessibleStudentFilter(req);
  const students = await req.db
    .model('Student')
    .find({
      ...filter,
      _id: studentId
    })
    .select(ACCESSIBLE_STUDENT_FIELDS)
    .limit(1)
    .lean();

  if (!students.length) {
    throw new ErrorResponse(404, 'Student not found');
  }

  return students[0];
};

const searchAccessibleStudents = async (req, args = {}) => {
  const filter = await getAccessibleStudentFilter(req);
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const limit = clampLimit(args.limit, 10, 25);

  if (!query) {
    const students = await req.db
      .model('Student')
      .find(filter)
      .select(
        'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors applying_program_count'
      )
      .limit(limit)
      .lean();

    return {
      data: students.map(normalizeStudentPickerRow)
    };
  }

  const textCandidates = await req.db
    .model('Student')
    .find({
      ...filter,
      $text: { $search: query }
    })
    .select(
      'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors applying_program_count'
    )
    .limit(limit)
    .lean();

  if (textCandidates.length > 0) {
    return {
      data: textCandidates.map(normalizeStudentPickerRow)
    };
  }

  const escapedQuery = escapeRegex(query);
  const escapedQueryNoSpace = escapeRegex(query.replace(/\s+/g, ''));
  const fallbackRegex = new RegExp(escapedQuery, 'i');
  const fallbackNoSpaceRegex = new RegExp(escapedQueryNoSpace, 'i');

  const fallbackCandidates = await req.db
    .model('Student')
    .find({
      ...filter,
      $or: [
        { firstname: fallbackRegex },
        { lastname: fallbackRegex },
        { email: fallbackRegex },
        { firstname_chinese: fallbackNoSpaceRegex },
        { lastname_chinese: fallbackNoSpaceRegex },
        {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ['$lastname_chinese', ''] },
                  { $ifNull: ['$firstname_chinese', ''] }
                ]
              },
              regex: escapedQueryNoSpace,
              options: 'i'
            }
          }
        },
        {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ['$firstname', ''] },
                  ' ',
                  { $ifNull: ['$lastname', ''] }
                ]
              },
              regex: escapedQuery,
              options: 'i'
            }
          }
        },
        {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ['$lastname', ''] },
                  ' ',
                  { $ifNull: ['$firstname', ''] }
                ]
              },
              regex: escapedQuery,
              options: 'i'
            }
          }
        }
      ]
    })
    .select(
      'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors applying_program_count'
    )
    .limit(limit)
    .lean();

  return {
    data: fallbackCandidates.map(normalizeStudentPickerRow)
  };
};

const searchStudents = async (req, args = {}) =>
  searchAccessibleStudents(req, args);

const listAccessibleStudents = async (req, args = {}) => {
  const filter = await getAccessibleStudentFilter(req);
  const students = await req.db
    .model('Student')
    .find(filter)
    .select(
      'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors applying_program_count'
    )
    .limit(clampLimit(args.limit, 25, 50))
    .lean();

  return {
    data: students.map(normalizeStudentPickerRow)
  };
};

const getStudentSummary = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);

  return {
    data: {
      ...normalizeUser(student),
      applyingProgramCount: student.applying_program_count,
      assignedTeam: {
        agents: (student.agents || [])
          .map(normalizeAssignedTeamMember)
          .filter(Boolean),
        editors: (student.editors || [])
          .map(normalizeAssignedTeamMember)
          .filter(Boolean)
      },
      profileDocuments: (student.profile || []).map(normalizeProfileDocument)
    }
  };
};

const getStudentApplications = async (req, args = {}) => {
  await requireAccessibleStudent(req, args.studentId);
  const applications = await req.db
    .model('Application')
    .find({ studentId: args.studentId })
    .select(
      'programId admission decided closed reject_reason admission_letter finalEnrolment application_year uni_assist'
    )
    .populate(
      'programId',
      'school program_name degree semester application_deadline country'
    )
    .lean();

  return {
    data: applications.map((application) => ({
      ...normalizeApplication(application),
      admission: application.admission,
      program: normalizeProgram(application.programId)
    }))
  };
};

const getLatestCommunications = async (req, args = {}) => {
  // If caller passes a cached student in `_student`, skip access re-check.
  if (!args._student) {
    await requireAccessibleStudent(req, args.studentId);
  }
  const limit = clampLimit(args.limit, 10, 50);

  // Normalize `days` argument:
  // - if `days` is omitted -> no date filter (caller likely wants all-time)
  // - if `days` is provided and >0 -> use clamped positive integer (max 365)
  // - if `days` is provided but non-positive or invalid -> fall back to RECENT_COMMUNICATION_DAYS
  let sinceDate = null;
  if (args.days != null) {
    const raw = Number(args.days);
    if (Number.isFinite(raw) && raw > 0) {
      const days = Math.min(Math.floor(raw), 365);
      sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    } else {
      const days = RECENT_COMMUNICATION_DAYS;
      sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }
  }

  const query = {
    student_id: args.studentId
  };
  if (sinceDate) {
    query.createdAt = { $gte: sinceDate };
  }

  const messages = await req.db
    .model('Communication')
    .find(query)
    .populate('user_id', 'firstname lastname role')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    data: messages.reverse().map(normalizeMessage)
  };
};

const getProfileDocuments = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);

  return {
    data: (student.profile || []).map(normalizeProfileDocument)
  };
};

const getAdmissionsOverview = async (req, args = {}) => {
  const applications = await getStudentApplications(req, args);
  return {
    data: applications.data.filter(
      (application) => application.status?.admissionLabel === 'admitted'
    )
  };
};

const getSupportTickets = async (req, args = {}) => {
  if (args.studentId) {
    await requireAccessibleStudent(req, args.studentId);
  }
  const tickets = await req.db
    .model('Complaint')
    .find(args.studentId ? { requester_id: args.studentId } : {})
    .select('requester_id title description status category updatedAt messages')
    .limit(clampLimit(args.limit, 10, 25))
    .lean();

  return { data: tickets };
};

const getStudentContext = async (req, args = {}) => {
  const studentSummary = await getStudentSummary(req, args);
  const student = studentSummary.data;

  return {
    data: {
      student: {
        id: student.id,
        displayName: student.name,
        chineseName: student.chineseName,
        email: student.email,
        role: student.role
      },
      applyingProgramCount: student.applyingProgramCount,
      assignedTeam: student.assignedTeam,
      profileDocuments: student.profileDocuments
    }
  };
};

const getApplicationContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const applications = await req.db
    .model('Application')
    .find({ studentId: args.studentId })
    .select(
      'programId admission decided closed reject_reason admission_letter finalEnrolment application_year uni_assist'
    )
    .populate(
      'programId',
      'school program_name degree semester application_deadline country'
    )
    .lean();

  return {
    data: {
      student: {
        id: student._id?.toString?.() || student.id,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      applications: applications.map(normalizeApplicationContextItem)
    }
  };
};

const getRecentCommunicationContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const messages = await getLatestCommunications(req, {
    studentId: args.studentId,
    limit: args.limit,
    days: args.days ?? RECENT_COMMUNICATION_DAYS,
    _student: student
  });

  return {
    data: {
      student: {
        id: student._id?.toString?.() || student.id,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      messages: messages.data
    }
  };
};

const getAllCommunicationContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const limit = clampLimit(args.limit, 120, ALL_COMMUNICATION_MAX_LIMIT);
  const messages = await req.db
    .model('Communication')
    .find({
      student_id: args.studentId
    })
    .populate('user_id', 'firstname lastname role')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    data: {
      student: {
        id: student._id?.toString?.() || student.id,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      messageScope: 'all',
      messages: messages.reverse().map(normalizeMessage)
    }
  };
};

const getDocumentContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const documents = await getProfileDocuments(req, args);
  const missingRequiredDocuments = documents.data.filter(
    (document) => document.required && !document.hasFile
  );

  return {
    data: {
      student: {
        id: student._id?.toString?.() || student.id,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      documents: documents.data,
      missingRequiredDocuments
    }
  };
};

const getSupportTicketContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const tickets = await getSupportTickets(req, {
    studentId: args.studentId,
    limit: args.limit
  });

  return {
    data: {
      student: {
        id: student._id?.toString?.() || student.id,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      tickets: tickets.data
    }
  };
};

const getDocumentThreadContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const studentId = toObjectIdString(student._id || student.id);

  const [threads, applications] = await Promise.all([
    req.db
      .model('Documentthread')
      .find({ student_id: args.studentId })
      .select(
        'file_type student_id application_id isFinalVersion latest_message_left_by_id updatedAt messages'
      )
      .sort({ updatedAt: -1 })
      .lean(),
    req.db
      .model('Application')
      .find({ studentId: args.studentId })
      .select('programId')
      .populate('programId', 'school program_name')
      .lean()
  ]);

  const programByApplicationId = new Map(
    (applications || []).map((application) => {
      const appId = toObjectIdString(application._id || application.id);
      return [
        appId,
        application.programId
          ? {
              id: toObjectIdString(
                application.programId._id || application.programId.id
              ),
              school: application.programId.school,
              name:
                application.programId.program_name ||
                application.programId.programName ||
                application.programId.name
            }
          : null
      ];
    })
  );

  const normalizedThreads = (threads || []).map((thread) => {
    const applicationId = toObjectIdString(thread.application_id);
    const latestMessageAt = safeDate(thread.updatedAt);
    const latestMessageBy = toObjectIdString(thread.latest_message_left_by_id);
    const isFinalVersion = Boolean(thread.isFinalVersion);

    return {
      threadType: applicationId ? 'application' : 'general',
      fileType: thread.file_type || null,
      program: applicationId
        ? programByApplicationId.get(applicationId) || null
        : null,
      isFinalVersion,
      latestMessageAt: latestMessageAt?.toISOString?.() || null,
      latestMessageBy: latestMessageBy || null,
      pendingOwner: resolvePendingOwner({ latestMessageBy, studentId }),
      riskFlags: buildThreadRiskFlags({
        isFinalVersion,
        latestMessageAt
      }),
      recentMessages: normalizeThreadMessages(thread.messages, 3)
    };
  });

  const openThreads = normalizedThreads.filter(
    (thread) => !thread.isFinalVersion
  );

  return {
    data: {
      student: {
        id: studentId,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      totalThreads: normalizedThreads.length,
      openThreadsCount: openThreads.length,
      threads: normalizedThreads
    }
  };
};

const getCrmLeadMeetingContext = async (req, args = {}) => {
  const student = await requireAccessibleStudent(req, args.studentId);
  const studentId = toObjectIdString(student._id || student.id);
  await assertLeadAccessForStudent(req, studentId, student);

  const postgres = getPostgresDb();
  const [lead] = await postgres
    .select({
      id: leads.id,
      fullName: leads.fullName,
      status: leads.status,
      closeLikelihood: leads.closeLikelihood,
      salesUserId: leads.salesUserId,
      updatedAt: leads.updatedAt
    })
    .from(leads)
    .where(eq(leads.userId, studentId))
    .limit(1);

  if (!lead) {
    return {
      data: {
        student: {
          id: studentId,
          displayName:
            [student.firstname, student.lastname].filter(Boolean).join(' ') ||
            undefined,
          email: student.email
        },
        lead: null,
        meetings: []
      }
    };
  }

  const meetings = await postgres
    .select({
      id: meetingTranscripts.id,
      title: meetingTranscripts.title,
      date: meetingTranscripts.date,
      dateString: meetingTranscripts.dateString,
      duration: meetingTranscripts.duration,
      summary: meetingTranscripts.summary,
      transcriptUrl: meetingTranscripts.transcriptUrl,
      participants: meetingTranscripts.participants
    })
    .from(meetingTranscripts)
    .where(
      and(
        eq(meetingTranscripts.leadId, lead.id),
        not(eq(meetingTranscripts.isArchived, true))
      )
    )
    .orderBy(desc(meetingTranscripts.date))
    .limit(clampLimit(args.limit, 8, 20));

  return {
    data: {
      student: {
        id: studentId,
        displayName:
          [student.firstname, student.lastname].filter(Boolean).join(' ') ||
          undefined,
        email: student.email
      },
      lead,
      meetings: (meetings || []).map((meeting) => ({
        ...meeting,
        date:
          typeof meeting.date === 'number'
            ? new Date(meeting.date).toISOString()
            : meeting.date
      }))
    }
  };
};

const getProgramBrief = async (req, args = {}) => {
  const program = await req.db
    .model('Program')
    .findById(args.programId)
    .select('school program_name degree semester application_deadline country')
    .lean();

  return { data: normalizeProgram(program) };
};

const registry = {
  search_students: searchStudents,
  get_student_context: getStudentContext,
  get_application_context: getApplicationContext,
  get_recent_communication_context: getRecentCommunicationContext,
  get_all_communication_context: getAllCommunicationContext,
  get_document_context: getDocumentContext,
  get_document_thread_context: getDocumentThreadContext,
  get_crm_lead_meeting_context: getCrmLeadMeetingContext,
  get_support_ticket_context: getSupportTicketContext,
  search_accessible_students: searchAccessibleStudents,
  list_accessible_students: listAccessibleStudents,
  get_student_summary: getStudentSummary,
  get_student_applications: getStudentApplications,
  get_latest_communications: getLatestCommunications,
  get_profile_documents: getProfileDocuments,
  get_admissions_overview: getAdmissionsOverview,
  get_support_tickets: getSupportTickets,
  get_program_brief: getProgramBrief
};

const AI_ASSIST_TOOL_NAMES = Object.freeze(Object.keys(registry));

const hasTool = (toolName) => Boolean(registry[toolName]);

const runTool = async (req, toolName, args) => {
  const tool = registry[toolName];
  if (!tool) {
    throw new ErrorResponse(400, `Unknown AI Assist tool: ${toolName}`);
  }
  return tool(req, args);
};

module.exports = {
  AI_ASSIST_TOOL_NAMES,
  hasTool,
  registry,
  runTool,
  requireAccessibleStudent,
  listAccessibleStudents,
  normalizeStudentPickerRow,
  searchAccessibleStudents
};
