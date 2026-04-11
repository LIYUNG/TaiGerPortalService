/* eslint-disable no-use-before-define */
const mongoose = require('mongoose');
const {
  Role,
  is_TaiGer_Admin,
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Student
} = require('@taiger-common/core');

const { ErrorResponse } = require('../../common/errors');
const { ManagerType } = require('../../constants');
const { openAIClient, OpenAiModel } = require('../openai');
const { getPermission } = require('../../utils/queryFunctions');
const {
  normalizeApplication,
  normalizeMessage,
  normalizeProfileDocument,
  normalizeUser
} = require('./normalizers');

const MESSAGE_PAGE_SIZE = 5;
const DEFAULT_MESSAGE_PAGES = 3;
const MAX_MESSAGE_PAGES = 10;

async function runChatbot(req, { message, studentId, maxMessagePages }) {
  await assertCanAccessStudent(req, studentId);

  const context = await getStudentContext(req, {
    studentId,
    maxMessagePages
  });

  const response = await openAIClient.chat.completions.create({
    model: OpenAiModel.GPT_4_o,
    messages: [
      {
        role: 'system',
        content:
          'You are a TaiGer Portal assistant. Answer only from the provided TaiGer context. Be concise, factual, and use the same language as the user when possible. Never reveal credentials, hidden fields, or raw internal IDs unless the user explicitly asks for an ID that is already present in context.'
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            userQuestion: message,
            context
          },
          null,
          2
        )
      }
    ],
    temperature: 0.2
  });

  return {
    answer: response.choices[0]?.message?.content || '',
    contextSummary: {
      student: context.student,
      applicationCount: context.applications.length,
      messageCount: context.messages.length,
      profileDocumentCount: context.profileDocuments.length
    }
  };
}

async function getStudentContext(req, { studentId, maxMessagePages }) {
  const [student, applications, messages] = await Promise.all([
    getStudent(req, studentId),
    getApplications(req, studentId),
    getMessages(req, {
      studentId,
      maxMessagePages
    })
  ]);

  return {
    student: normalizeUser(student),
    assignedTeam: {
      agents: (student.agents || []).map(normalizeUser),
      editors: (student.editors || []).map(normalizeUser)
    },
    applications: applications.map(normalizeApplication),
    admittedApplications: applications
      .map(normalizeApplication)
      .filter((application) => application.status.admissionLabel === 'admitted'),
    profileDocuments: (student.profile || []).map(normalizeProfileDocument),
    messages
  };
}

async function getStudent(req, studentId) {
  const student = await req.db
    .model('Student')
    .findById(studentId)
    .select(
      'firstname lastname firstname_chinese lastname_chinese email role archiv agents editors profile applying_program_count'
    )
    .populate('agents editors', 'firstname lastname email role archiv')
    .lean();

  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  return student;
}

function getApplications(req, studentId) {
  return req.db
    .model('Application')
    .find({ studentId })
    .select(
      'programId admission decided closed reject_reason admission_letter finalEnrolment application_year uni_assist'
    )
    .populate(
      'programId',
      'school program_name degree semester application_deadline country'
    )
    .lean();
}

async function getMessages(req, { studentId, maxMessagePages }) {
  const safeMaxPages = Math.min(
    Math.max(Number(maxMessagePages) || DEFAULT_MESSAGE_PAGES, 1),
    MAX_MESSAGE_PAGES
  );

  const messages = await req.db
    .model('Communication')
    .find({
      student_id: new mongoose.Types.ObjectId(studentId)
    })
    .populate('user_id', 'firstname lastname role')
    .sort({ createdAt: -1 })
    .limit(MESSAGE_PAGE_SIZE * safeMaxPages)
    .lean();

  return messages.reverse().map(normalizeMessage);
}

async function getAccessibleStudentFilter(req) {
  const { user } = req;
  const activeFilter = { $or: [{ archiv: { $exists: false } }, { archiv: false }] };

  if (is_TaiGer_Student(user)) {
    return { _id: user._id };
  }

  if (is_TaiGer_Admin(user)) {
    return activeFilter;
  }

  if (is_TaiGer_Agent(user)) {
    const permission = await getPermission(req, user);
    return permission?.canAccessAllChat
      ? activeFilter
      : { ...activeFilter, agents: user._id };
  }

  if (is_TaiGer_Editor(user)) {
    const permission = await getPermission(req, user);
    return permission?.canAccessAllChat
      ? activeFilter
      : { ...activeFilter, editors: user._id };
  }

  if (user.role === Role.Manager) {
    return getManagerStudentFilter(user, activeFilter);
  }

  throw new ErrorResponse(403, 'Permission denied');
}

function getManagerStudentFilter(user, activeFilter) {
  const filters = [];

  if (
    [ManagerType.Agent, ManagerType.AgentAndEditor].includes(user.manager_type) &&
    user.agents?.length
  ) {
    filters.push({ agents: { $in: user.agents } });
  }

  if (
    [ManagerType.Editor, ManagerType.AgentAndEditor].includes(user.manager_type) &&
    user.editors?.length
  ) {
    filters.push({ editors: { $in: user.editors } });
  }

  if (filters.length === 0) {
    return { ...activeFilter, _id: { $exists: false } };
  }

  return {
    ...activeFilter,
    $and: [{ $or: filters }]
  };
}

async function assertCanAccessStudent(req, studentId) {
  if (!mongoose.Types.ObjectId.isValid(studentId)) {
    throw new ErrorResponse(400, 'Invalid student id');
  }

  const { user } = req;

  if (is_TaiGer_Student(user)) {
    if (user._id.toString() !== studentId) {
      throw new ErrorResponse(403, 'Not allowed to access other students.');
    }
    return;
  }

  const filter = await getAccessibleStudentFilter(req);
  const student = await req.db
    .model('Student')
    .findOne({
      ...filter,
      _id: studentId
    })
    .select('_id')
    .lean();

  if (!student) {
    throw new ErrorResponse(403, 'Not allowed to access this student.');
  }
}

module.exports = {
  runChatbot
};
