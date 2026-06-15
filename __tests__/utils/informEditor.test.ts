// Unit tests for utils/informEditor.js
//
// Two exported helpers: addMessageInThread (appends a structured message to a
// thread doc and saves it) and informOnSurveyUpdate (a notification fan-out that
// branches on role / archive / editor-presence / fileType). All collaborators
// are mocked: the email service, the document-thread / student / permission
// services, and the constants archive guards. No DB, no email.
//
// These helpers are plain async functions (NOT asyncHandler-wrapped), so every
// positional arg — including `thread` — is received correctly, and informStaff
// is called with the full (user, staff, student, fileType, thread, message)
// arity. All branches are therefore deterministic and covered below: the
// non-Student/archived early returns, the informNoEditor cascade, and the three
// staff-notification branches (Supplementary_Form agent, editor with programId,
// editor without programId) that previously crashed on the dropped `thread`.

// Stub the model registry so auto-mocked services don't compile Mongoose (NO DB).
jest.mock('../../models', () => ({}));
jest.mock('../../services/email', () => ({
  sendNewApplicationMessageInThreadEmail: jest.fn(),
  sendAssignEditorReminderEmail: jest.fn(),
  sendNewGeneraldocMessageInThreadEmail: jest.fn()
}));
jest.mock('../../services/documentthreads');
jest.mock('../../services/students');
jest.mock('../../services/permissions');
jest.mock('../../constants', () => ({
  isArchiv: jest.fn(),
  isNotArchiv: jest.fn()
}));

const { Role } = require('@taiger-common/core');
const {
  sendNewApplicationMessageInThreadEmail,
  sendAssignEditorReminderEmail,
  sendNewGeneraldocMessageInThreadEmail
} = require('../../services/email');
const DocumentThreadService = require('../../services/documentthreads');
const StudentService = require('../../services/students');
const PermissionService = require('../../services/permissions');
const { isArchiv, isNotArchiv } = require('../../constants');
const { ErrorResponse } = require('../../common/errors');
const {
  informOnSurveyUpdate,
  addMessageInThread
} = require('../../utils/informEditor');

// informOnSurveyUpdate calls informNoEditor WITHOUT awaiting it, so its async
// side-effects settle on later microtasks. Flush them before asserting.
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('addMessageInThread', () => {
  it('throws 403 when the thread does not exist', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    await expect(
      addMessageInThread('hi', 'thread-1', 'user-1')
    ).rejects.toBeInstanceOf(ErrorResponse);
  });

  it('appends a structured message and saves the thread', async () => {
    const save = jest.fn().mockResolvedValue();
    const messages = [];
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      messages,
      save
    });

    await addMessageInThread('hello', 'thread-1', 'user-1');

    expect(messages).toHaveLength(1);
    // userId is now received (no longer dropped) and stored on the message
    expect(messages[0].user_id).toBe('user-1');
    // message is an EditorJS-style serialized block carrying the text
    const parsed = JSON.parse(messages[0].message);
    expect(parsed.blocks[0].data.text).toBe('hello');
    expect(save).toHaveBeenCalled();
  });
});

describe('informOnSurveyUpdate', () => {
  const baseThread = { _id: { toString: () => 'thread-1' } };

  const threadDoc = () => ({
    messages: [],
    save: jest.fn().mockResolvedValue()
  });

  it('adds the automatic notification message then returns for non-Student callers', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());

    await informOnSurveyUpdate(
      { role: Role.Agent, firstname: 'A', lastname: 'B' },
      { studentId: 'stu-1' },
      baseThread
    );

    expect(DocumentThreadService.getThreadDocById).toHaveBeenCalled();
    // non-Student: no student lookup
    expect(StudentService.getStudentByIdPopulated).not.toHaveBeenCalled();
  });

  it('returns early when the student is archived', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      agents: [{}],
      editors: [{}]
    });
    isArchiv.mockReturnValue(true);

    await informOnSurveyUpdate(
      { role: Role.Student, firstname: 'S', lastname: 'T' },
      { studentId: 'stu-1', fileType: 'ML' },
      baseThread
    );

    expect(sendAssignEditorReminderEmail).not.toHaveBeenCalled();
    expect(sendNewGeneraldocMessageInThreadEmail).not.toHaveBeenCalled();
  });

  it('informs agents + editor-leads to assign an editor when there is no agent', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: 'stu-1',
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [], // noEditor branch is keyed on agents.length === 0
      editors: []
    });
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    isArchiv.mockReturnValue(false);
    isNotArchiv.mockReturnValue(true);
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      {
        user_id: {
          firstname: 'Lead',
          lastname: 'Editor',
          email: 'lead@x.io'
        }
      }
    ]);

    await informOnSurveyUpdate(
      { role: Role.Student, firstname: 'S', lastname: 'T' },
      { studentId: 'stu-1', fileType: 'ML' },
      baseThread
    );
    await flush();

    // informNoEditor flips needEditor and queries editor-lead permissions
    expect(StudentService.updateStudentByIdRaw).toHaveBeenCalledWith('stu-1', {
      needEditor: true
    });
    expect(PermissionService.findPermissionsWithUser).toHaveBeenCalledWith({
      canAssignEditors: true
    });
    // editor-lead reminder sent
    expect(sendAssignEditorReminderEmail).toHaveBeenCalled();
  });

  it('informNoEditor exits early when no editor-lead permissions are found', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: 'stu-1',
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: []
    });
    StudentService.updateStudentByIdRaw.mockResolvedValue({});
    isArchiv.mockReturnValue(false);
    isNotArchiv.mockReturnValue(true);
    PermissionService.findPermissionsWithUser.mockResolvedValue([]);

    await informOnSurveyUpdate(
      { role: Role.Student, firstname: 'S', lastname: 'T' },
      { studentId: 'stu-1', fileType: 'ML' },
      baseThread
    );
    await flush();

    // findPermissionsWithUser was queried, but the empty result -> early return
    expect(PermissionService.findPermissionsWithUser).toHaveBeenCalled();
    // only the active-agent reminders ran (none, since no agents); no editor-lead
    // reminders were sent because the permissions list was empty.
    expect(sendAssignEditorReminderEmail).not.toHaveBeenCalled();
  });

  // The three branches below dereference `thread` (and inform staff with the
  // full 6-arg arity) — they crashed before the asyncHandler removal.
  const threadWithProgram = {
    _id: { toString: () => 'thread-1' },
    program_id: { school: 'ETH', program_name: 'CS' }
  };

  it('informs the agent for a Supplementary_Form survey', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: 'stu-1',
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [{ firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io' }],
      editors: []
    });
    isArchiv.mockReturnValue(false);
    isNotArchiv.mockReturnValue(true);

    await informOnSurveyUpdate(
      { role: Role.Student, firstname: 'S', lastname: 'T' },
      { studentId: 'stu-1', fileType: 'Supplementary_Form' },
      threadWithProgram
    );
    await flush();

    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalledTimes(1);
    const [, payload] = sendNewApplicationMessageInThreadEmail.mock.calls[0];
    expect(payload.school).toBe('ETH');
    expect(payload.thread_id).toBe('thread-1');
  });

  it('informs an editor via the application email when the survey has a programId', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: 'stu-1',
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [{ firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io' }],
      editors: [{ firstname: 'Ed', lastname: 'Itor', email: 'ed@x.io' }]
    });
    isArchiv.mockReturnValue(false);
    isNotArchiv.mockReturnValue(true);

    await informOnSurveyUpdate(
      { role: Role.Student, firstname: 'S', lastname: 'T' },
      { studentId: 'stu-1', fileType: 'ML', programId: 'prog-1' },
      threadWithProgram
    );
    await flush();

    expect(sendNewApplicationMessageInThreadEmail).toHaveBeenCalledTimes(1);
    expect(sendNewGeneraldocMessageInThreadEmail).not.toHaveBeenCalled();
  });

  it('informs an editor via the general-doc email (uses thread._id) without a programId', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(threadDoc());
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: 'stu-1',
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [{ firstname: 'Ag', lastname: 'Ent', email: 'ag@x.io' }],
      editors: [{ firstname: 'Ed', lastname: 'Itor', email: 'ed@x.io' }]
    });
    isArchiv.mockReturnValue(false);
    isNotArchiv.mockReturnValue(true);

    await informOnSurveyUpdate(
      { role: Role.Student, firstname: 'S', lastname: 'T' },
      { studentId: 'stu-1', fileType: 'ML' },
      { _id: { toString: () => 'thread-1' } }
    );
    await flush();

    expect(sendNewGeneraldocMessageInThreadEmail).toHaveBeenCalledTimes(1);
    const [recipient, msg] =
      sendNewGeneraldocMessageInThreadEmail.mock.calls[0];
    expect(recipient.address).toBe('ed@x.io');
    expect(msg.thread_id).toBe('thread-1');
  });
});
