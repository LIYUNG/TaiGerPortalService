jest.mock('../../../database', () => ({
  getPostgresDb: jest.fn()
}));

jest.mock('../../../utils/queryFunctions', () => ({
  getPermission: jest.fn().mockResolvedValue({})
}));

import { Role } from '../../../constants';
import { getPostgresDb } from '../../../database';
import StudentService from '../../../services/students';
import ApplicationService from '../../../services/applications';
import CommunicationService from '../../../services/communications';
import ComplaintService from '../../../services/complaints';
import DocumentThreadService from '../../../services/documentthreads';
import ProgramService from '../../../services/programs';
import tools from '../../../services/ai-assist/tools';

const { runTool, hasTool, AI_ASSIST_TOOL_NAMES, normalizeStudentPickerRow } =
  tools;

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
      AI_ASSIST_TOOL_NAMES.push('x');
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
      result.data.applications.map((a) => [a.id, a])
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
      (t) => t.threadType === 'application'
    );
    expect(appThread.program).toMatchObject({ school: 'TU', name: 'CS' });
    expect(appThread.pendingOwner).toBe('team');
    const generalThread = result.data.threads.find(
      (t) => t.threadType === 'general'
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
});
