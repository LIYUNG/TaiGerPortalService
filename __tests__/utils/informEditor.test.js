// Unit tests for utils/informEditor.js
//
// Two exported helpers: addMessageInThread (appends a structured message to a
// thread doc and saves it) and informOnSurveyUpdate (a notification fan-out that
// branches on role / archive / editor-presence / fileType). All collaborators
// are mocked: the email service, the document-thread / student / permission
// services, and the constants archive guards. No DB, no email.
//
// NOTE on skipped branches (all rooted in asyncHandler dropping positional
// args beyond (req,res,next)):
//   * informOnSurveyUpdate is asyncHandler-wrapped, so its 4th arg `thread` is
//     ALWAYS undefined at runtime. The "Supplementary_Form agent" and "editor
//     WITH programId" branches additionally call informStaff with the wrong
//     arity (5 args into a 6-arg signature => thread.program_id.school throws),
//     and the "editor without programId" branch dereferences thread._id — all
//     of which throw a TypeError in production. These crash paths are NOT tested
//     here (testing them would only assert a latent bug). We cover the
//     deterministic, non-crashing branches: addMessageInThread, the non-Student
//     early return, the archived early return, and the informNoEditor cascade.
//   See FINAL REPORT.

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
      addMessageInThread({}, 'hi', 'thread-1', 'user-1')
    ).rejects.toBeInstanceOf(ErrorResponse);
  });

  it('appends a structured message and saves the thread', async () => {
    const save = jest.fn().mockResolvedValue();
    const messages = [];
    DocumentThreadService.getThreadDocById.mockResolvedValue({
      messages,
      save
    });

    // NOTE: addMessageInThread is wrapped by asyncHandler, whose returned fn
    // forwards only (req, res, next) — so the 4th positional arg (userId) is
    // dropped. We pass it for documentation but assert the real behaviour.
    await addMessageInThread({}, 'hello', 'thread-1', 'user-1');

    expect(messages).toHaveLength(1);
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
      {},
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
      {},
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
      {},
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
      {},
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
});
