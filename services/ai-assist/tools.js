const { ErrorResponse } = require('../../common/errors');
const { getAccessibleStudentFilter } = require('./studentAccess');
const {
  normalizeApplication,
  normalizeMessage,
  normalizeProfileDocument,
  normalizeUser
} = require('../chatbot/normalizers');

const clampLimit = (value, fallback, max) =>
  Math.min(Math.max(Number(value) || fallback, 1), max);

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

const searchAccessibleStudents = async (req, args = {}) => {
  const filter = await getAccessibleStudentFilter(req);
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const finalFilter = query
    ? {
        ...filter,
        $text: { $search: query }
      }
    : filter;
  const students = await req.db
    .model('Student')
    .find(finalFilter)
    .select(
      'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors applying_program_count'
    )
    .limit(clampLimit(args.limit, 10, 25))
    .lean();

  return {
    data: students.map((student) => ({
      ...normalizeUser(student),
      applyingProgramCount: student.applying_program_count,
      agents: (student.agents || []).map((agent) => agent.toString?.() || agent),
      editors: (student.editors || []).map((editor) => editor.toString?.() || editor)
    }))
  };
};

const getStudentSummary = async (req, args = {}) => {
  const student = await req.db
    .model('Student')
    .findById(args.studentId)
    .select(
      'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors profile applying_program_count'
    )
    .populate('agents editors', 'firstname lastname email role archiv')
    .lean();

  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  return {
    data: {
      ...normalizeUser(student),
      applyingProgramCount: student.applying_program_count,
      assignedTeam: {
        agents: (student.agents || []).map(normalizeUser),
        editors: (student.editors || []).map(normalizeUser)
      },
      profileDocuments: (student.profile || []).map(normalizeProfileDocument)
    }
  };
};

const getStudentApplications = async (req, args = {}) => {
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
  const limit = clampLimit(args.limit, 10, 50);
  const messages = await req.db
    .model('Communication')
    .find({ student_id: args.studentId })
    .populate('user_id', 'firstname lastname role')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    data: messages.reverse().map(normalizeMessage)
  };
};

const getProfileDocuments = async (req, args = {}) => {
  const student = await req.db
    .model('Student')
    .findById(args.studentId)
    .select('profile')
    .lean();

  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

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
  const tickets = await req.db
    .model('Complaint')
    .find(args.studentId ? { requester_id: args.studentId } : {})
    .select('requester_id title description status category updatedAt messages')
    .limit(clampLimit(args.limit, 10, 25))
    .lean();

  return { data: tickets };
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
  search_accessible_students: searchAccessibleStudents,
  get_student_summary: getStudentSummary,
  get_student_applications: getStudentApplications,
  get_latest_communications: getLatestCommunications,
  get_profile_documents: getProfileDocuments,
  get_admissions_overview: getAdmissionsOverview,
  get_support_tickets: getSupportTickets,
  get_program_brief: getProgramBrief
};

const runTool = async (req, toolName, args) => {
  const tool = registry[toolName];
  if (!tool) {
    throw new ErrorResponse(400, `Unknown AI Assist tool: ${toolName}`);
  }
  return tool(req, args);
};

module.exports = {
  registry,
  runTool
};
