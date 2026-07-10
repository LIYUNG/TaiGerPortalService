jest.mock('../../../database', () => ({
  getPostgresDb: jest.fn()
}));

jest.mock('../../../utils/queryFunctions', () => ({
  getPermission: jest.fn().mockResolvedValue({})
}));

import { Role } from '../../../constants';
import { getPostgresDb as getPostgresDbModule } from '../../../database';
import { getPermission as getPermissionModule } from '../../../utils/queryFunctions';
import StudentServiceModule from '../../../services/students';
import ApplicationServiceModule from '../../../services/applications';
import CommunicationServiceModule from '../../../services/communications';
import ComplaintServiceModule from '../../../services/complaints';
import DocumentThreadServiceModule from '../../../services/documentthreads';
import ProgramServiceModule from '../../../services/programs';
import tools from '../../../services/ai-assist/tools';

// These service modules are NOT auto-mocked via `jest.mock(...)`; each method
// is stubbed per-test via `jest.spyOn`. TS still sees the real, strictly-typed
// signatures though, so re-type each as a bag of jest.Mock methods so the
// per-test `.mockResolvedValue()/.mockResolvedValueOnce()/.mock.calls` access
// type-checks while still allowing partial (non-Mongoose) return shapes. The
// `jest.spyOn` calls below operate on the very same runtime object references,
// so the cast has no effect on behavior.
type MockedModule = Record<string, jest.Mock>;
const StudentService = StudentServiceModule as unknown as MockedModule;
const ApplicationService = ApplicationServiceModule as unknown as MockedModule;
const CommunicationService =
  CommunicationServiceModule as unknown as MockedModule;
const ComplaintService = ComplaintServiceModule as unknown as MockedModule;
const DocumentThreadService =
  DocumentThreadServiceModule as unknown as MockedModule;
const ProgramService = ProgramServiceModule as unknown as MockedModule;

// `database` and `utils/queryFunctions` ARE auto-mocked above via factories;
// TS resolves the named imports against the real module signatures, so cast
// each single binding to jest.Mock for the per-test `.mockReturnValue()` /
// `.mockResolvedValueOnce()` calls.
const getPostgresDb = getPostgresDbModule as unknown as jest.Mock;
const getPermission = getPermissionModule as unknown as jest.Mock;

// `tools` is a CommonJS (`export =`) module. `runTool`'s inferred return type
// is a union across every handler in the registry (since the handler is
// looked up by a runtime-only `toolName` string), which TS cannot narrow at
// any individual call site, and its `args` parameter is required even though
// several tests intentionally pass `undefined` to exercise each handler's own
// `= {}` default-arg branch. Cast to a permissive signature so
// `result.data.<field>` access and `undefined` args type-check without
// touching call sites or assertions.
const { hasTool, AI_ASSIST_TOOL_NAMES, normalizeStudentPickerRow } = tools;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiToolResult = { data: any };
const runTool = tools.runTool as unknown as (
  req: unknown,
  toolName: string,
  args?: unknown
) => Promise<AiToolResult>;

const ADMIN_REQ = { user: { role: Role.Admin, _id: 'admin_1' } };

const baseStudent = (overrides = {}) => ({
  _id: 'student_1',
  firstname: 'Ada',
  lastname: 'Lovelace',
  firstname_chinese: '達',
  lastname_chinese: '愛',
  email: 'ada@example.com',
  role: Role.Student,
  agents: ['agent_1'],
  editors: [],
  profile: [],
  applying_program_count: 2,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(StudentService, 'findStudentsSelect')
    .mockResolvedValue([baseStudent()]);
  jest
    .spyOn(StudentService, 'getStudentByIdSelect')
    .mockResolvedValue(baseStudent());
  jest
    .spyOn(ApplicationService, 'findApplicationsSelectPopulate')
    .mockResolvedValue([]);
  jest.spyOn(CommunicationService, 'findPopulatedSorted').mockResolvedValue([]);
  jest.spyOn(ComplaintService, 'findComplaintsSelect').mockResolvedValue([]);
  jest
    .spyOn(DocumentThreadService, 'findThreadsSelectSorted')
    .mockResolvedValue([]);
  jest.spyOn(ProgramService, 'getProgramByIdSelect').mockResolvedValue(null);
});

afterEach(() => jest.restoreAllMocks());

describe('registry metadata', () => {
  it('exposes a frozen tool name list and hasTool predicate', () => {
    expect(AI_ASSIST_TOOL_NAMES).toContain('get_student_context');
    expect(hasTool('get_student_context')).toBe(true);
    expect(hasTool('does_not_exist')).toBe(false);
    expect(() => {
      // The registry name list is `Object.freeze`d at runtime (readonly at the
      // type level); cast to a mutable array so the intentional
      // frozen-array-throws assertion below type-checks.
      (AI_ASSIST_TOOL_NAMES as unknown as string[]).push('x');
    }).toThrow();
  });

  it('throws for an unknown tool', async () => {
    await expect(runTool(ADMIN_REQ, 'no_such_tool', {})).rejects.toThrow(
      'Unknown AI Assist tool'
    );
  });
});

describe('normalizeStudentPickerRow', () => {
  it('stringifies agent and editor ids', () => {
    const row = normalizeStudentPickerRow(
      baseStudent({
        agents: [{ toString: () => 'agent_x' }, 'agent_y'],
        editors: [{ toString: () => 'editor_x' }]
      })
    );
    expect(row.agents).toEqual(['agent_x', 'agent_y']);
    expect(row.editors).toEqual(['editor_x']);
    expect(row.applyingProgramCount).toBe(2);
  });
});

describe('search_accessible_students', () => {
  it('lists students without a query', async () => {
    const result = await runTool(ADMIN_REQ, 'search_accessible_students', {});
    expect(result.data[0]).toMatchObject({
      id: 'student_1',
      name: 'Ada Lovelace'
    });
  });

  it('returns text-search matches when present', async () => {
    StudentService.findStudentsSelect.mockResolvedValueOnce([baseStudent()]);
    const result = await runTool(ADMIN_REQ, 'search_accessible_students', {
      query: 'Ada',
      limit: 5
    });
    expect(result.data).toHaveLength(1);
    expect(StudentService.findStudentsSelect).toHaveBeenCalledTimes(1);
  });

  it('falls back to regex search when text search returns nothing', async () => {
    StudentService.findStudentsSelect
      .mockResolvedValueOnce([]) // text search empty
      .mockResolvedValueOnce([baseStudent({ _id: 'student_fb' })]); // fallback regex
    const result = await runTool(ADMIN_REQ, 'search_accessible_students', {
      query: 'Ada Lovelace'
    });
    expect(StudentService.findStudentsSelect).toHaveBeenCalledTimes(2);
    expect(result.data[0].id).toBe('student_fb');
  });
});

describe('list_accessible_students', () => {
  it('returns clamped picker rows', async () => {
    const result = await runTool(ADMIN_REQ, 'list_accessible_students', {
      limit: 999
    });
    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      50
    );
    expect(result.data).toHaveLength(1);
  });
});

describe('requireAccessibleStudent gate', () => {
  it('throws 404 when the student is not accessible', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([]);
    await expect(
      runTool(ADMIN_REQ, 'get_student_summary', { studentId: 'nope' })
    ).rejects.toThrow('Student not found');
  });
});

describe('get_student_summary', () => {
  it('returns profile, assigned team, and profile documents', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({
        agents: [
          { _id: 'agent_1', firstname: 'Al', lastname: 'Pha' },
          'agent_raw'
        ],
        editors: [{ id: 'editor_1', firstname: 'Ed', lastname: 'Itor' }, {}],
        profile: [{ _id: 'doc_1', name: 'CV', required: true, path: '/cv' }]
      })
    ]);
    const result = await runTool(ADMIN_REQ, 'get_student_summary', {
      studentId: 'student_1'
    });
    expect(result.data.assignedTeam.agents.length).toBeGreaterThanOrEqual(1);
    expect(result.data.assignedTeam.agents).toContainEqual({ id: 'agent_raw' });
    expect(result.data.profileDocuments[0]).toMatchObject({
      name: 'CV',
      hasFile: true
    });
  });
});

describe('get_student_context', () => {
  it('returns trimmed student identity context', async () => {
    const result = await runTool(ADMIN_REQ, 'get_student_context', {
      studentId: 'student_1'
    });
    expect(result.data.student).toMatchObject({
      id: 'student_1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com'
    });
  });
});

describe('get_student_applications & get_application_context', () => {
  const appFixture = {
    _id: 'app_1',
    admission: 'O',
    finalEnrolment: false,
    uni_assist: { status: 'not_started' },
    admission_letter: { path: null },
    programId: {
      _id: 'p1',
      school: 'TU Berlin',
      program_name: 'CS',
      country: 'DE',
      application_deadline: '2026-07-01'
    }
  };

  it('get_student_applications maps program facts', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      appFixture
    ]);
    const result = await runTool(ADMIN_REQ, 'get_student_applications', {
      studentId: 'student_1'
    });
    expect(result.data[0]).toMatchObject({
      id: 'app_1',
      admission: 'O',
      program: { id: 'p1', school: 'TU Berlin', name: 'CS' }
    });
  });

  it('get_application_context derives status, risks, and next actions for admitted apps', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      appFixture
    ]);
    const result = await runTool(ADMIN_REQ, 'get_application_context', {
      studentId: 'student_1'
    });
    const item = result.data.applications[0];
    expect(item.status).toBe('admitted');
    expect(item.risks).toEqual(
      expect.arrayContaining([
        'final enrolment not confirmed',
        'uni-assist not started',
        'admission letter file missing'
      ])
    );
    expect(item.nextActions).toEqual(
      expect.arrayContaining([
        'confirm enrolment decision with student',
        'start uni-assist process',
        'upload or verify admission letter'
      ])
    );
  });

  it('get_application_context derives final_enrolled, rejected, and closed statuses', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      {
        _id: 'a_final',
        finalEnrolment: 'O',
        programId: { _id: 'p', school: 'S' }
      },
      {
        _id: 'a_rej',
        admission: 'X',
        reject_reason: 'low gpa',
        programId: null
      },
      { _id: 'a_closed', closed: 'O', programId: null },
      { _id: 'a_prog', programId: null }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_application_context', {
      studentId: 'student_1'
    });
    const byId = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.data.applications.map((a: any) => [a.id, a])
    );
    expect(byId.a_final.status).toBe('final_enrolled');
    expect(byId.a_final.decision).toBe('final enrolment confirmed');
    expect(byId.a_rej.status).toBe('rejected');
    expect(byId.a_rej.decision).toBe('low gpa');
    expect(byId.a_closed.status).toBe('closed');
    expect(byId.a_prog.status).toBe('in_progress');
    expect(byId.a_prog.decision).toBe('under review');
  });
});

describe('communication tools', () => {
  const message = {
    _id: 'm1',
    message: 'Hello',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    user_id: { firstname: 'Agent', lastname: 'Chen', role: Role.Agent },
    files: []
  };

  it('get_latest_communications without days applies no date filter', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([message]);
    await runTool(ADMIN_REQ, 'get_latest_communications', {
      studentId: 'student_1'
    });
    expect(CommunicationService.findPopulatedSorted.mock.calls[0][0]).toEqual({
      student_id: 'student_1'
    });
  });

  it('get_latest_communications falls back to default window for invalid days', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    await runTool(ADMIN_REQ, 'get_latest_communications', {
      studentId: 'student_1',
      days: -5
    });
    expect(
      CommunicationService.findPopulatedSorted.mock.calls[0][0].createdAt.$gte
    ).toBeInstanceOf(Date);
  });

  it('get_recent_communication_context wraps messages with student identity', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([message]);
    const result = await runTool(
      ADMIN_REQ,
      'get_recent_communication_context',
      {
        studentId: 'student_1'
      }
    );
    expect(result.data.student.id).toBe('student_1');
    expect(result.data.messages).toHaveLength(1);
  });

  it('get_all_communication_context marks scope all', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([message]);
    const result = await runTool(ADMIN_REQ, 'get_all_communication_context', {
      studentId: 'student_1'
    });
    expect(result.data.messageScope).toBe('all');
  });
});

describe('document tools', () => {
  it('get_profile_documents normalizes the profile array', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({ profile: [{ _id: 'd1', name: 'CV', required: true }] })
    ]);
    const result = await runTool(ADMIN_REQ, 'get_profile_documents', {
      studentId: 'student_1'
    });
    expect(result.data[0]).toMatchObject({ name: 'CV', hasFile: false });
  });

  it('get_document_context flags missing required documents', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({
        profile: [
          { _id: 'd1', name: 'CV', required: true, path: null },
          { _id: 'd2', name: 'GPA', required: true, path: '/g' },
          { _id: 'd3', name: 'Extra', required: false }
        ]
      })
    ]);
    const result = await runTool(ADMIN_REQ, 'get_document_context', {
      studentId: 'student_1'
    });
    expect(result.data.documents).toHaveLength(3);
    expect(result.data.missingRequiredDocuments).toHaveLength(1);
    expect(result.data.missingRequiredDocuments[0].name).toBe('CV');
  });

  it('get_document_thread_context normalizes application and general threads', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      {
        _id: 'app_1',
        programId: { _id: 'p1', school: 'TU', program_name: 'CS' }
      }
    ]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([
      {
        application_id: 'app_1',
        file_type: 'CV',
        isFinalVersion: false,
        latest_message_left_by_id: 'student_1',
        updatedAt: new Date('2026-04-02T00:00:00Z'),
        messages: [
          {
            message: 'hi',
            createdAt: new Date('2026-04-01T00:00:00Z'),
            user_id: 'agent_1'
          }
        ]
      },
      {
        application_id: null,
        file_type: null,
        isFinalVersion: true,
        latest_message_left_by_id: null,
        updatedAt: null,
        messages: []
      }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_document_thread_context', {
      studentId: 'student_1'
    });
    expect(result.data.totalThreads).toBe(2);
    expect(result.data.openThreadsCount).toBe(1);
    const appThread = result.data.threads.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.threadType === 'application'
    );
    expect(appThread.program).toMatchObject({ school: 'TU', name: 'CS' });
    expect(appThread.pendingOwner).toBe('team');
    const generalThread = result.data.threads.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.threadType === 'general'
    );
    expect(generalThread.riskFlags).toEqual(
      expect.arrayContaining(['no_recent_message'])
    );
    expect(generalThread.pendingOwner).toBe('unknown');
  });
});

describe('support ticket tools', () => {
  it('get_support_tickets without studentId queries all', async () => {
    ComplaintService.findComplaintsSelect.mockResolvedValue([{ id: 't1' }]);
    const result = await runTool(ADMIN_REQ, 'get_support_tickets', {});
    expect(ComplaintService.findComplaintsSelect.mock.calls[0][0]).toEqual({});
    expect(result.data).toHaveLength(1);
  });

  it('get_support_ticket_context scopes to a student', async () => {
    ComplaintService.findComplaintsSelect.mockResolvedValue([{ id: 't1' }]);
    const result = await runTool(ADMIN_REQ, 'get_support_ticket_context', {
      studentId: 'student_1'
    });
    expect(result.data.student.id).toBe('student_1');
    expect(result.data.tickets).toHaveLength(1);
  });
});

describe('get_admissions_overview', () => {
  it('filters to admitted applications by admissionLabel', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      { _id: 'a1', admission: 'O', programId: { _id: 'p1', school: 'S' } },
      { _id: 'a2', admission: 'X', programId: { _id: 'p2', school: 'S2' } }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_admissions_overview', {
      studentId: 'student_1'
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('a1');
  });
});

describe('get_program_brief', () => {
  it('returns a normalized program', async () => {
    ProgramService.getProgramByIdSelect.mockResolvedValue({
      _id: 'p1',
      school: 'TU',
      program_name: 'CS'
    });
    const result = await runTool(ADMIN_REQ, 'get_program_brief', {
      programId: 'p1'
    });
    expect(result.data).toMatchObject({ id: 'p1', school: 'TU', name: 'CS' });
  });

  it('returns undefined when the program is missing', async () => {
    ProgramService.getProgramByIdSelect.mockResolvedValue(null);
    const result = await runTool(ADMIN_REQ, 'get_program_brief', {
      programId: 'x'
    });
    expect(result.data).toBeUndefined();
  });
});

describe('get_crm_lead_meeting_context access control', () => {
  it('allows an assigned Agent and returns lead with meetings', async () => {
    const student = baseStudent({ agents: ['agent_1'], editors: [] });
    StudentService.findStudentsSelect.mockResolvedValue([student]);
    const leadLimit = jest
      .fn()
      .mockResolvedValue([{ id: 'lead_1', fullName: 'L' }]);
    const meetingsLimit = jest.fn().mockResolvedValue([
      { id: 'mtg_1', title: 'Intro', date: 1700000000000 },
      { id: 'mtg_2', title: 'Followup', date: '2026-01-01' }
    ]);
    getPostgresDb.mockReturnValue({
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({ limit: leadLimit }))
          }))
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({ limit: meetingsLimit }))
            }))
          }))
        }))
    });

    const result = await runTool(
      { user: { role: Role.Agent, _id: 'agent_1' } },
      'get_crm_lead_meeting_context',
      { studentId: 'student_1' }
    );
    expect(result.data.lead).toMatchObject({ id: 'lead_1' });
    expect(result.data.meetings[0].date).toBe(
      new Date(1700000000000).toISOString()
    );
    expect(result.data.meetings[1].date).toBe('2026-01-01');
  });

  it('returns null lead and empty meetings when no lead row exists', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    getPostgresDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) }))
        }))
      }))
    });
    const result = await runTool(ADMIN_REQ, 'get_crm_lead_meeting_context', {
      studentId: 'student_1'
    });
    expect(result.data.lead).toBeNull();
    expect(result.data.meetings).toEqual([]);
  });

  it('denies a Student-role caller from CRM lead data', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    // A Student role is rejected earlier by requireAccessibleStudent ->
    // getAccessibleStudentFilter ('Permission denied'), before the CRM check.
    await expect(
      runTool(
        { user: { role: Role.Student, _id: 'student_1' } },
        'get_crm_lead_meeting_context',
        { studentId: 'student_1' }
      )
    ).rejects.toThrow('Permission denied');
  });

  it('denies a non agent/editor role that nonetheless has chat access', async () => {
    // A role outside Admin/Manager/Agent/Editor that has `canAccessAllChat`
    // passes requireAccessibleStudent (getAccessibleStudentFilter returns the
    // active filter) but is rejected by assertLeadAccessForStudent's role guard.
    getPermission.mockResolvedValueOnce({ canAccessAllChat: true });
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    await expect(
      runTool(
        { user: { role: 'Auditor', _id: 'aud_1' } },
        'get_crm_lead_meeting_context',
        { studentId: 'student_1' }
      )
    ).rejects.toThrow('not allowed to view CRM lead data');
  });

  it('denies an unassigned Agent', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({ agents: ['other'], editors: [] })
    ]);
    await expect(
      runTool(
        { user: { role: Role.Agent, _id: 'agent_zzz' } },
        'get_crm_lead_meeting_context',
        { studentId: 'student_1' }
      )
    ).rejects.toThrow('not allowed to view CRM lead data');
  });

  it('allows a Manager and looks up the student by id when not pre-loaded', async () => {
    // Manager passes the early role gate in assertLeadAccessForStudent. The
    // student is accessible (Admin-style empty filter), and the CRM check
    // returns immediately for Manager without touching agents/editors.
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    getPostgresDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) }))
        }))
      }))
    });
    const result = await runTool(
      { user: { role: Role.Manager, _id: 'mgr_1' } },
      'get_crm_lead_meeting_context',
      { studentId: 'student_1' }
    );
    expect(result.data.lead).toBeNull();
  });

  it('allows an assigned Editor whose assignment uses ObjectId-like ids', async () => {
    // Exercises the agents/editors flattening + toObjectIdString on each id and
    // the Role.Editor branch of the role guard.
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({
        agents: [{ toString: () => 'agent_other' }],
        editors: [{ toString: () => 'editor_1' }]
      })
    ]);
    getPostgresDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) }))
        }))
      }))
    });
    const result = await runTool(
      { user: { role: Role.Editor, _id: 'editor_1' } },
      'get_crm_lead_meeting_context',
      { studentId: 'student_1' }
    );
    expect(result.data.lead).toBeNull();
  });
});

describe('default-arg and fallback branch coverage', () => {
  it('runs argument-less tools through their default `{}` parameter', async () => {
    // Calling via runTool with `undefined` args drives every handler's
    // `args: AiToolArgs = {}` default-arg branch.
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    const listResult = await runTool(
      ADMIN_REQ,
      'list_accessible_students',
      undefined
    );
    expect(listResult.data).toHaveLength(1);

    const searchResult = await runTool(
      ADMIN_REQ,
      'search_accessible_students',
      undefined
    );
    expect(searchResult.data).toHaveLength(1);

    // `search_students` delegates to searchAccessibleStudents and uses its own
    // default-arg fallback.
    const aliasResult = await runTool(ADMIN_REQ, 'search_students', undefined);
    expect(aliasResult.data).toHaveLength(1);

    ComplaintService.findComplaintsSelect.mockResolvedValue([]);
    const ticketsResult = await runTool(
      ADMIN_REQ,
      'get_support_tickets',
      undefined
    );
    expect(ticketsResult.data).toEqual([]);
    // No studentId -> the `if (args.studentId)` guard is skipped.
    expect(ComplaintService.findComplaintsSelect.mock.calls[0][0]).toEqual({});

    ProgramService.getProgramByIdSelect.mockResolvedValue(null);
    const programResult = await runTool(
      ADMIN_REQ,
      'get_program_brief',
      undefined
    );
    expect(programResult.data).toBeUndefined();
  });

  it('trims a query argument and falls back to default window when days <= 0 via Math.floor', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    const result = await runTool(ADMIN_REQ, 'search_accessible_students', {
      query: '   '
    });
    // Whitespace-only query trims to empty -> no-query branch.
    expect(result.data).toHaveLength(1);
    expect(StudentService.findStudentsSelect).toHaveBeenCalledTimes(1);
  });

  it('clamps a positive days value and applies a date filter', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    await runTool(ADMIN_REQ, 'get_latest_communications', {
      studentId: 'student_1',
      days: 5000 // > 365 -> clamped to 365
    });
    expect(
      CommunicationService.findPopulatedSorted.mock.calls[0][0].createdAt.$gte
    ).toBeInstanceOf(Date);
  });

  it('skips the access re-check when a cached _student is supplied', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    StudentService.findStudentsSelect.mockClear();
    await runTool(ADMIN_REQ, 'get_latest_communications', {
      studentId: 'student_1',
      _student: baseStudent()
    });
    // requireAccessibleStudent (-> findStudentsSelect) must NOT be called.
    expect(StudentService.findStudentsSelect).not.toHaveBeenCalled();
  });
});

describe('normalizer fallback branches', () => {
  it('normalizeStudentPickerRow handles missing agents/editors arrays', () => {
    const row = normalizeStudentPickerRow(
      baseStudent({ agents: undefined, editors: undefined })
    );
    expect(row.agents).toEqual([]);
    expect(row.editors).toEqual([]);
  });

  it('get_student_summary resolves team members by bare-id and string fallbacks', async () => {
    // normalizeAssignedTeamMember: when normalizeUser yields no `.id` (member has
    // neither firstname nor _id/id giving an identity), fall through to the
    // `_id`/`id` toString extraction; plain-string members take the string branch;
    // null members are filtered out.
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({
        agents: [
          // normalizeUser returns id undefined -> fall to _id.toString()
          { _id: { toString: () => 'agent_objid' } },
          'agent_string'
        ],
        // member with only `id` (string) -> normalizeUser id branch; null -> dropped
        editors: [null, { id: 'editor_str' }]
      })
    ]);
    const result = await runTool(ADMIN_REQ, 'get_student_summary', {
      studentId: 'student_1'
    });
    // _id-only agent: normalizeUser sets id from _id.toString(), returning the
    // full user object whose id is the stringified _id.
    expect(result.data.assignedTeam.agents.map((a) => a.id)).toEqual(
      expect.arrayContaining(['agent_objid', 'agent_string'])
    );
    // null editor filtered out; the id-only editor resolved.
    expect(result.data.assignedTeam.editors.map((e) => e.id)).toEqual([
      'editor_str'
    ]);
  });

  it('normalizeProgram uses program.id and programName/name fallbacks', async () => {
    ProgramService.getProgramByIdSelect.mockResolvedValue({
      id: 'p_bare', // no _id -> id fallback
      school: 'S',
      programName: 'Camelcased' // program_name missing -> programName fallback
    });
    const result = await runTool(ADMIN_REQ, 'get_program_brief', {
      programId: 'p_bare'
    });
    expect(result.data).toMatchObject({ id: 'p_bare', name: 'Camelcased' });

    ProgramService.getProgramByIdSelect.mockResolvedValue({
      id: 'p_name',
      school: 'S',
      name: 'PlainName' // both program_name and programName missing -> name
    });
    const result2 = await runTool(ADMIN_REQ, 'get_program_brief', {
      programId: 'p_name'
    });
    expect(result2.data.name).toBe('PlainName');
  });

  it('deriveApplicationDecision returns the generic rejection message when reject_reason is falsy', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      { _id: 'a_x', admission: 'X', programId: null }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_application_context', {
      studentId: 'student_1'
    });
    expect(result.data.applications[0].status).toBe('rejected');
    expect(result.data.applications[0].decision).toBe('application rejected');
  });
});

describe('context student-identity fallbacks (no firstname/lastname, bare id)', () => {
  // A student doc keyed by `id` instead of `_id`, with no names and no email,
  // exercising the `_id?.toString?.() || student.id` and
  // `[firstname,lastname].filter(Boolean).join(' ') || undefined` branches in
  // every *_context handler.
  const namelessStudent = () => ({
    id: 'student_bare',
    firstname: undefined,
    lastname: undefined,
    email: undefined,
    role: Role.Student,
    agents: [],
    editors: [],
    profile: [],
    applying_program_count: 0
  });

  beforeEach(() => {
    StudentService.findStudentsSelect.mockResolvedValue([namelessStudent()]);
  });

  it('get_application_context falls back to bare id and undefined displayName', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    const result = await runTool(ADMIN_REQ, 'get_application_context', {
      studentId: 'student_bare'
    });
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
  });

  it('get_recent_communication_context falls back to bare id', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    const result = await runTool(
      ADMIN_REQ,
      'get_recent_communication_context',
      { studentId: 'student_bare' }
    );
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
  });

  it('get_all_communication_context falls back to bare id', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    const result = await runTool(ADMIN_REQ, 'get_all_communication_context', {
      studentId: 'student_bare'
    });
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
  });

  it('get_document_context falls back to bare id', async () => {
    const result = await runTool(ADMIN_REQ, 'get_document_context', {
      studentId: 'student_bare'
    });
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
    expect(result.data.missingRequiredDocuments).toEqual([]);
  });

  it('get_support_ticket_context falls back to bare id', async () => {
    ComplaintService.findComplaintsSelect.mockResolvedValue([]);
    const result = await runTool(ADMIN_REQ, 'get_support_ticket_context', {
      studentId: 'student_bare'
    });
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
  });

  it('get_document_thread_context falls back to bare id', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([]);
    const result = await runTool(ADMIN_REQ, 'get_document_thread_context', {
      studentId: 'student_bare'
    });
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
    expect(result.data.totalThreads).toBe(0);
  });

  it('get_crm_lead_meeting_context (no lead) falls back to bare id', async () => {
    getPostgresDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) }))
        }))
      }))
    });
    const result = await runTool(ADMIN_REQ, 'get_crm_lead_meeting_context', {
      studentId: 'student_bare'
    });
    expect(result.data.student.id).toBe('student_bare');
    expect(result.data.student.displayName).toBeUndefined();
  });
});

describe('document thread normalization edge cases', () => {
  it('handles null thread/application lists and message field fallbacks', async () => {
    // applications resolves to a list where one application has no programId
    // (-> map value null) and a program with programName/name fallbacks.
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      { _id: 'app_no_program', programId: null },
      {
        id: 'app_camel', // bare id (no _id)
        programId: { id: 'p_camel', school: 'S', programName: 'CamelProg' }
      }
    ]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([
      {
        _id: 't_app',
        application_id: 'app_camel',
        file_type: 'CV',
        isFinalVersion: true,
        latest_message_left_by_id: 'someone_else',
        updatedAt: new Date('2026-04-02T00:00:00Z'),
        // messages exercising text/createdAt/author extraction fallbacks:
        messages: [
          // uses `text` field, `timestamp` date, `userId` author
          {
            text: 'second',
            timestamp: new Date('2026-04-03T00:00:00Z'),
            userId: 'student_1'
          },
          // uses `content`, `updatedAt` date, `user_id` author
          {
            content: 'first',
            updatedAt: new Date('2026-04-01T00:00:00Z'),
            user_id: { toString: () => 'agent_obj' }
          },
          // empty message -> filtered out
          {},
          // body field + invalid date -> createdAt null
          { body: 'nodate', createdAt: 'not-a-date' }
        ]
      },
      {
        _id: 't_general_pending_student',
        application_id: 'missing_app', // not in program map -> get() returns null
        file_type: undefined,
        isFinalVersion: false,
        latest_message_left_by_id: 'team_member',
        updatedAt: new Date('2026-04-05T00:00:00Z'),
        messages: null // not an array -> [] branch
      }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_document_thread_context', {
      studentId: 'student_1'
    });
    expect(result.data.totalThreads).toBe(2);
    expect(result.data.openThreadsCount).toBe(1);

    const appThread = result.data.threads.find((t) => t.id === 't_app');
    // sorted ascending then sliced; messages with valid text retained
    expect(appThread.recentMessages.length).toBeGreaterThanOrEqual(2);
    // application_id present but not in program map -> program is the camel one
    expect(appThread.program).toMatchObject({ name: 'CamelProg' });
    // latest_message_left_by_id !== studentId -> 'student'
    expect(appThread.pendingOwner).toBe('student');

    const pendingThread = result.data.threads.find(
      (t) => t.id === 't_general_pending_student'
    );
    // application_id 'missing_app' not in map -> program null
    expect(pendingThread.program).toBeNull();
    expect(pendingThread.recentMessages).toEqual([]);
  });
});

describe('handlers invoked through their default `{}` argument', () => {
  // Driving each handler via runTool(req, name, undefined) exercises the
  // `args: AiToolArgs = {}` default-arg branch on the handler itself. The
  // mocked services tolerate an undefined studentId.
  beforeEach(() => {
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    ComplaintService.findComplaintsSelect.mockResolvedValue([]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([]);
    getPostgresDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) }))
        }))
      }))
    });
  });

  it.each([
    'get_student_summary',
    'get_student_applications',
    'get_latest_communications',
    'get_profile_documents',
    'get_admissions_overview',
    'get_student_context',
    'get_application_context',
    'get_recent_communication_context',
    'get_all_communication_context',
    'get_document_context',
    'get_support_ticket_context',
    'get_document_thread_context',
    'get_crm_lead_meeting_context'
  ])('%s resolves with undefined args', async (toolName) => {
    const result = await runTool(ADMIN_REQ, toolName, undefined);
    expect(result).toHaveProperty('data');
  });
});

describe('message and application normalization fallbacks', () => {
  it('normalizeMessage falls back to bare id and empty files array', async () => {
    // message has `id` (no _id) and no `files` field -> `message.files || []`.
    CommunicationService.findPopulatedSorted.mockResolvedValue([
      { id: 'msg_bare', message: 'Hi', createdAt: new Date('2026-01-01') }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_all_communication_context', {
      studentId: 'student_1'
    });
    expect(result.data.messages[0].id).toBe('msg_bare');
    expect(result.data.messages[0].attachments).toEqual([]);
  });

  it('normalizeApplicationContextItem falls back to a bare application id', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      { id: 'app_bare_id', programId: null } // no _id -> id fallback
    ]);
    const result = await runTool(ADMIN_REQ, 'get_application_context', {
      studentId: 'student_1'
    });
    expect(result.data.applications[0].id).toBe('app_bare_id');
  });
});

describe('getStudentSummary with absent collections', () => {
  it('defaults agents/editors/profile to empty arrays', async () => {
    // student missing agents, editors, and profile -> the `|| []` right sides.
    StudentService.findStudentsSelect.mockResolvedValue([
      {
        _id: 'student_min',
        firstname: 'Min',
        lastname: 'Imal',
        email: 'min@example.com',
        role: Role.Student,
        applying_program_count: 0
      }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_student_summary', {
      studentId: 'student_min'
    });
    expect(result.data.assignedTeam.agents).toEqual([]);
    expect(result.data.assignedTeam.editors).toEqual([]);
    expect(result.data.profileDocuments).toEqual([]);
  });

  it('get_profile_documents defaults a missing profile array', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      {
        _id: 'student_min2',
        firstname: 'Min',
        email: 'm@example.com',
        role: Role.Student
      }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_profile_documents', {
      studentId: 'student_min2'
    });
    expect(result.data).toEqual([]);
  });
});

describe('thread message extraction fallbacks', () => {
  it('keeps messages that have only a timestamp and maps null createdAt iso', async () => {
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([
      {
        _id: 't1',
        application_id: null,
        file_type: 'CV',
        isFinalVersion: false,
        latest_message_left_by_id: null,
        updatedAt: new Date('2026-04-02T00:00:00Z'),
        messages: [
          // no text but has a valid date -> retained; toISOString applied
          { createdAt: new Date('2026-04-01T00:00:00Z') },
          // text present but no date/author -> createdAt null branch in final map
          { message: 'only text' }
        ]
      }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_document_thread_context', {
      studentId: 'student_1'
    });
    const thread = result.data.threads[0];
    expect(thread.recentMessages.length).toBe(2);
    const textOnly = thread.recentMessages.find((m) => m.text === 'only text');
    expect(textOnly.createdAt).toBeNull();
    expect(textOnly.authorId).toBeNull();
  });
});

describe('crm meeting date and displayName fallbacks', () => {
  it('joins firstname/lastname displayName and leaves non-numeric meeting dates intact', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      baseStudent({ _id: 'student_crm' })
    ]);
    const leadLimit = jest
      .fn()
      .mockResolvedValue([{ id: 'lead_crm', fullName: 'L' }]);
    // meetings is returned as null-ish for one branch and string-date for another
    const meetingsLimit = jest
      .fn()
      .mockResolvedValue([{ id: 'm1', title: 'T', date: '2026-02-02' }]);
    getPostgresDb.mockReturnValue({
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({ limit: leadLimit }))
          }))
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({ limit: meetingsLimit }))
            }))
          }))
        }))
    });
    const result = await runTool(ADMIN_REQ, 'get_crm_lead_meeting_context', {
      studentId: 'student_crm'
    });
    expect(result.data.student.displayName).toBe('Ada Lovelace');
    expect(result.data.meetings[0].date).toBe('2026-02-02');
  });
});

describe('picker row and id stringification edge cases', () => {
  it('normalizeStudentPickerRow keeps falsy agent/editor entries via the right-hand fallback', () => {
    // null entries: `null?.toString?.()` is undefined -> `|| agent` returns null.
    const row = normalizeStudentPickerRow(
      baseStudent({ agents: [null], editors: [undefined] })
    );
    expect(row.agents).toEqual([null]);
    expect(row.editors).toEqual([undefined]);
  });

  it('get_document_thread_context coerces an id whose toString yields empty', async () => {
    // thread._id.toString() returns '' -> toObjectIdString right-hand `|| ''`.
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([
      {
        _id: { toString: () => '' },
        application_id: null,
        file_type: null,
        isFinalVersion: false,
        latest_message_left_by_id: { toString: () => '' },
        updatedAt: null,
        messages: []
      }
    ]);
    const result = await runTool(ADMIN_REQ, 'get_document_thread_context', {
      studentId: 'student_1'
    });
    expect(result.data.threads[0].id).toBe('');
    expect(result.data.threads[0].latestMessageBy).toBeNull();
  });

  it('get_crm_lead_meeting_context tolerates a null meetings result', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent()]);
    const leadLimit = jest.fn().mockResolvedValue([{ id: 'lead_n' }]);
    const meetingsLimit = jest.fn().mockResolvedValue(null); // -> `|| []`
    getPostgresDb.mockReturnValue({
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({ limit: leadLimit }))
          }))
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({ limit: meetingsLimit }))
            }))
          }))
        }))
    });
    const result = await runTool(ADMIN_REQ, 'get_crm_lead_meeting_context', {
      studentId: 'student_1'
    });
    expect(result.data.meetings).toEqual([]);
  });
});

describe('getLatestCommunications days edge', () => {
  it('treats a non-finite days value as the default window', async () => {
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    await runTool(ADMIN_REQ, 'get_latest_communications', {
      studentId: 'student_1',
      days: 'abc' // Number('abc') is NaN -> not finite -> default window
    });
    expect(
      CommunicationService.findPopulatedSorted.mock.calls[0][0].createdAt.$gte
    ).toBeInstanceOf(Date);
  });
});
