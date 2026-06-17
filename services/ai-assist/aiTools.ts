import path from 'path';

import { ErrorResponse } from '../../common/errors';
import { AWS_S3_BUCKET_NAME } from '../../config';
import { getS3Object } from '../../aws/s3';
import { extractTextFromBuffer } from '../../utils/utils_function';
import tools from './tools';
import { buildOverview, loadPortfolio, collectUpcomingDeadlines } from './overview';
import ProgramService from '../programs';
import DocumentThreadService from '../documentthreads';

// Consolidated, provider-neutral AI Assist tool registry. Replaces the previous
// 18 overlapping tool definitions with ~10 focused tools. Each handler is access
// -scoped (reusing studentAccess via the existing ./tools handlers or
// requireAccessibleStudent). Tool definitions are provider-neutral JSON schema;
// the LLM layer (./llm) adapts them to Anthropic / OpenAI tool formats.

const MAX_DOCUMENT_CHARS = 24000;

const str = (description) => ({ type: 'string', description });
const int = (description, maximum) => ({
  type: 'integer',
  description,
  minimum: 1,
  ...(maximum ? { maximum } : {})
});

const makeTool = (name, description, properties = {}, required = []) => ({
  name,
  description,
  parameters: {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
});

const toIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.toString?.() || '';
};

// ---- New / composed handlers ------------------------------------------------

const findStudents = (req, args = {}) =>
  tools.searchAccessibleStudents(req, args);

const getStudentOverview = async (req, args = {}) => {
  const [summary, applications, threads] = await Promise.all([
    tools.runTool(req, 'get_student_summary', args),
    tools.runTool(req, 'get_student_applications', args),
    tools.runTool(req, 'get_document_thread_context', args)
  ]);

  return {
    data: {
      ...summary.data,
      applications: applications.data,
      documentThreads: {
        total: threads.data.totalThreads,
        open: threads.data.openThreadsCount,
        threads: threads.data.threads
      }
    }
  };
};

const getProgram = async (req, args = {}) => {
  const program = await ProgramService.getProgramByIdSelect(
    args.programId,
    'school program_name degree semester lang application_deadline application_start country ' +
      'ml_required ml_requirements sop_required phs_required rl_required is_rl_specific ' +
      'essay_required essay_requirements essay_difficulty portfolio_required portfolio_requirements ' +
      'supplementary_form_required scholarship_form_required gpa_requirement uni_assist website'
  );

  if (!program) {
    throw new ErrorResponse(404, 'Program not found');
  }

  return { data: program };
};

const findUpcomingDeadlines = async (req, args = {}) => {
  const days = Math.min(Math.max(Number(args.days) || 30, 1), 365);
  const { applications, studentById } = await loadPortfolio(req);
  const items = collectUpcomingDeadlines(applications, studentById, days);

  return {
    data: {
      windowDays: days,
      count: items.length,
      deadlines: items.slice(0, 50)
    }
  };
};

const getMyOverview = async (req, args = {}) => {
  const overview = await buildOverview(req, {
    deadlineWindowDays: args.days
  });
  return { data: overview };
};

// Resolve and read a document's text content from S3, access-scoped.
// Primary path: a document thread id (CV/ML/RL/essay). Falls back to a base
// (profile) document on the student.
const readDocument = async (req, args = {}) => {
  let key = '';
  let fileName = '';
  let fileType = '';
  let source = '';

  if (args.threadId) {
    const thread = await DocumentThreadService.getThreadByIdLean(args.threadId);
    if (!thread) {
      throw new ErrorResponse(404, 'Document thread not found');
    }
    // Access check: the thread's student must be accessible to this user.
    await tools.requireAccessibleStudent(req, toIdString(thread.student_id));

    fileType = thread.file_type || '';
    source = 'document_thread';
    // Latest uploaded file across the thread's messages.
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    for (let i = messages.length - 1; i >= 0 && !key; i -= 1) {
      const files = Array.isArray(messages[i].file) ? messages[i].file : [];
      if (files.length) {
        const file = files[files.length - 1];
        key = file.path || '';
        fileName = file.name || '';
      }
    }
  } else if (args.studentId && args.documentName) {
    const student = await tools.requireAccessibleStudent(req, args.studentId);
    const document = (student.profile || []).find(
      (item) => item.name === args.documentName
    );
    if (!document) {
      throw new ErrorResponse(404, 'Base document not found');
    }
    key = document.path || '';
    fileName = document.name || '';
    fileType = document.name || '';
    source = 'base_document';
  } else {
    throw new ErrorResponse(
      400,
      'read_document requires either threadId or (studentId and documentName)'
    );
  }

  if (!key) {
    return {
      data: {
        source,
        fileType,
        fileName,
        available: false,
        message: 'No uploaded file found for this document.'
      }
    };
  }

  const extension = path.extname(fileName || key).replace(/^\./, '');
  const bytes = await getS3Object(AWS_S3_BUCKET_NAME, key);
  if (!bytes) {
    return {
      data: {
        source,
        fileType,
        fileName,
        available: false,
        message: 'File could not be retrieved from storage.'
      }
    };
  }

  const buffer = Buffer.from(bytes);
  const fullText = await extractTextFromBuffer(buffer, extension);
  const truncated = fullText.length > MAX_DOCUMENT_CHARS;
  const text = truncated ? fullText.slice(0, MAX_DOCUMENT_CHARS) : fullText;

  return {
    data: {
      source,
      fileType,
      fileName,
      extension,
      available: Boolean(text),
      truncated,
      charCount: text.length,
      text
    }
  };
};

// ---- Registry ---------------------------------------------------------------

const registry = {
  find_students: findStudents,
  get_student_overview: getStudentOverview,
  get_communications: (req, args) =>
    tools.runTool(req, 'get_latest_communications', args),
  get_document_threads: (req, args) =>
    tools.runTool(req, 'get_document_thread_context', args),
  get_support_tickets: (req, args) =>
    tools.runTool(req, 'get_support_tickets', args),
  get_program: getProgram,
  get_crm_lead: (req, args) =>
    tools.runTool(req, 'get_crm_lead_meeting_context', args),
  find_upcoming_deadlines: findUpcomingDeadlines,
  get_my_overview: getMyOverview,
  read_document: readDocument
};

const definitions = [
  makeTool(
    'find_students',
    'Search the students accessible to the current user by name, Chinese name, or email. Use this first to resolve a student id before calling student-specific tools.',
    {
      query: str('Search text (name, Chinese name, or email).'),
      limit: int('Maximum number of students to return.', 25)
    },
    ['query']
  ),
  makeTool(
    'get_student_overview',
    'Get a single consolidated overview of one accessible student: profile, assigned team, base documents, applications (status/admission/deadlines/risks), and document-thread status.',
    { studentId: str('Student id from find_students.') },
    ['studentId']
  ),
  makeTool(
    'get_communications',
    'Get recent communication messages between a student and the team. Optionally limit by number of days.',
    {
      studentId: str('Student id from find_students.'),
      days: int('Only include messages from the last N days.', 365),
      limit: int('Maximum number of messages to return.', 50)
    },
    ['studentId']
  ),
  makeTool(
    'get_document_threads',
    'Get document-thread status for a student (CV, ML, RL, essays, etc): which threads are open, who they are waiting on, risk flags, and recent messages.',
    { studentId: str('Student id from find_students.') },
    ['studentId']
  ),
  makeTool(
    'get_support_tickets',
    'Get support tickets. Pass studentId for one student, or omit for tickets across accessible students.',
    {
      studentId: str('Optional student id from find_students.'),
      limit: int('Maximum number of tickets to return.', 25)
    }
  ),
  makeTool(
    'get_program',
    'Get a program\'s facts and application requirements (motivation letter, essay, recommendation letters, portfolio, deadlines, language/GPA requirements). Use this when reviewing a document against what the program requires.',
    { programId: str('Program id seen in application/overview tool output.') },
    ['programId']
  ),
  makeTool(
    'get_crm_lead',
    'Get CRM lead and meeting-transcript context for a student (Admin/Manager, or an assigned Agent/Editor only).',
    {
      studentId: str('Student id from find_students.'),
      limit: int('Maximum number of meetings to return.', 20)
    },
    ['studentId']
  ),
  makeTool(
    'find_upcoming_deadlines',
    'Find application deadlines coming up across ALL the current user\'s accessible students within the next N days. Use for portfolio-wide "what is due soon" questions.',
    { days: int('Deadline window in days (default 30).', 365) }
  ),
  makeTool(
    'get_my_overview',
    'Get a cross-portfolio attention summary for the current user: upcoming deadlines, document threads waiting on the team, admitted-but-not-confirmed applications, and students missing required base documents. Use for "what needs my attention" questions.',
    { days: int('Deadline window in days for the overview (default 30).', 365) }
  ),
  makeTool(
    'read_document',
    'Read the actual text content of a student document stored on S3 so it can be reviewed. Provide a threadId (for CV/ML/RL/essay document threads) OR a studentId plus documentName (for base/profile documents). Returns extracted text (may be truncated for long documents).',
    {
      threadId: str('Document thread id (from get_document_threads / overview).'),
      studentId: str('Student id (when reading a base/profile document).'),
      documentName: str('Base document name (when reading a base/profile document).')
    }
  )
];

const definitionsByName = definitions.reduce(
  (accumulator, definition) => ({
    ...accumulator,
    [definition.name]: definition
  }),
  {}
);

const hasTool = (toolName) => Boolean(registry[toolName]);

const runTool = async (req, toolName, args) => {
  const tool = registry[toolName];
  if (!tool) {
    throw new ErrorResponse(400, `Unknown AI Assist tool: ${toolName}`);
  }
  return tool(req, args);
};

export = {
  definitions,
  definitionsByName,
  registry,
  hasTool,
  runTool
};
