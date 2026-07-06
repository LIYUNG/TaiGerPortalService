// Unit tests for services/ai-assist/overview.
// Pure-function helpers and collectors are tested directly.
// buildOverview / loadPortfolio are tested with service mocks.

jest.mock('../../../services/students', () => ({
  findStudentsSelect: jest.fn()
}));
jest.mock('../../../services/applications', () => ({
  findApplicationsSelectPopulate: jest.fn()
}));
jest.mock('../../../services/documentthreads', () => ({
  findThreadsSelectSorted: jest.fn(),
  getThreadsWaitingOnTeam: jest.fn()
}));
jest.mock('../../../services/communications', () => ({
  getLatestMessageAtForStudents: jest.fn(),
  getUnansweredStudentMessages: jest.fn(),
  getLatestStudentMessageAtForStudents: jest.fn()
}));
jest.mock('../../../services/ai-assist/studentAccess', () => ({
  getAccessibleStudentFilter: jest.fn().mockResolvedValue({})
}));
jest.mock('../../../constants', () => ({
  application_deadline_V2_calculator: jest.fn(() => '2099/12/31')
}));

import overview from '../../../services/ai-assist/overview';
const StudentService = require('../../../services/students');
const ApplicationService = require('../../../services/applications');
const DocumentThreadService = require('../../../services/documentthreads');
const CommunicationService = require('../../../services/communications');

const {
  collectThreadsWaitingOnTeam,
  collectCommunicationGaps,
  collectStudentSilence,
  collectUpcomingDeadlines,
  collectAdmittedNotConfirmed,
  collectMissingBaseDocuments,
  buildStudentStats,
  buildStudentTerms,
  buildFinalizedStudentIds,
  loadPortfolio,
  buildStudentsView,
  parseDeadline,
  toIdString,
  safeDate,
  isTruthyFlag,
  deriveStatus,
  studentLabel,
  buildOverview
} = overview as {
  collectThreadsWaitingOnTeam: (
    threads: any[],
    studentById: Map<string, any>,
    finalizedStudentIds?: Set<string>
  ) => any[];
  collectCommunicationGaps: (
    students: any[],
    applications: any[],
    unansweredSinceById: Map<string, Date>
  ) => any[];
  collectStudentSilence: (
    students: any[],
    applications: any[],
    latestStudentMessageAtById: Map<string, Date>,
    unansweredSinceById?: Map<string, Date>
  ) => any[];
  collectUpcomingDeadlines: (
    applications: any[],
    studentById: Map<string, any>,
    days: number,
    finalizedStudentIds?: Set<string>
  ) => any[];
  collectAdmittedNotConfirmed: (
    applications: any[],
    studentById: Map<string, any>
  ) => any[];
  collectMissingBaseDocuments: (students: any[]) => any[];
  buildStudentStats: (
    applications: any[]
  ) => Record<string, { offerCount: number; rejectCount: number }>;
  buildStudentTerms: (applications: any[]) => Record<string, string[]>;
  buildFinalizedStudentIds: (applications: any[]) => Set<string>;
  loadPortfolio: (req: any, opts?: any) => Promise<any>;
  buildStudentsView: (
    collected: Record<string, any[]>,
    statsById: Record<string, { offerCount: number; rejectCount: number }>,
    termsById: Record<string, string[]>,
    finalizedStudentIds: Set<string>,
    limit: number
  ) => { students: any[]; hasMoreStudents: boolean };
  parseDeadline: (deadlineString: string) => {
    date: Date | null;
    rolling: boolean;
    label: string;
  };
  toIdString: (value: unknown) => string;
  safeDate: (value: unknown) => Date | null;
  isTruthyFlag: (value: unknown) => boolean;
  deriveStatus: (application?: any) => string;
  studentLabel: (student: any) => any;
  buildOverview: (req: any, opts?: any) => Promise<any>;
};

const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n: number): Date =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const student = (id: string, firstname = 'Test', extras: any = {}) => ({
  _id: id,
  firstname,
  lastname: 'User',
  email: `${id}@example.com`,
  editors: [],
  applying_program_count: 3,
  createdAt: '2023-01-15T00:00:00.000Z',
  ...extras
});

// ─── toIdString ────────────────────────────────────────────────────────────
describe('toIdString', () => {
  it('returns empty string for falsy values', () => {
    expect(toIdString(null)).toBe('');
    expect(toIdString(undefined)).toBe('');
    expect(toIdString('')).toBe('');
  });

  it('returns the string when value is already a string', () => {
    expect(toIdString('abc')).toBe('abc');
  });

  it('calls toString() on objects', () => {
    const obj = { toString: () => 'obj-id' };
    expect(toIdString(obj)).toBe('obj-id');
  });

  it('returns empty string for objects without a toString method', () => {
    expect(toIdString(Object.create(null))).toBe('');
  });
});

// ─── safeDate ──────────────────────────────────────────────────────────────
describe('safeDate', () => {
  it('returns null for falsy input', () => {
    expect(safeDate(null)).toBeNull();
    expect(safeDate(undefined)).toBeNull();
  });

  it('returns a Date for a valid date string', () => {
    const d = safeDate('2024-01-15');
    expect(d).toBeInstanceOf(Date);
    expect(Number.isNaN((d as Date).getTime())).toBe(false);
  });

  it('passes a Date instance through', () => {
    const input = new Date('2024-06-01');
    const result = safeDate(input);
    expect(result).toBeInstanceOf(Date);
  });

  it('returns null for an invalid date string', () => {
    expect(safeDate('not-a-date')).toBeNull();
  });
});

// ─── isTruthyFlag ──────────────────────────────────────────────────────────
describe('isTruthyFlag', () => {
  it.each([true, 'O', 'Y'])('returns true for %p', (v) => {
    expect(isTruthyFlag(v)).toBe(true);
  });

  it.each([false, null, undefined, 'X', 0, ''])('returns false for %p', (v) => {
    expect(isTruthyFlag(v)).toBe(false);
  });
});

// ─── deriveStatus ──────────────────────────────────────────────────────────
describe('deriveStatus', () => {
  it('returns final_enrolled when finalEnrolment is truthy', () => {
    expect(deriveStatus({ finalEnrolment: true })).toBe('final_enrolled');
    expect(deriveStatus({ finalEnrolment: 'O' })).toBe('final_enrolled');
  });

  it('returns admitted for admission O without final enrolment', () => {
    expect(deriveStatus({ admission: 'O' })).toBe('admitted');
  });

  it('returns rejected for admission X', () => {
    expect(deriveStatus({ admission: 'X' })).toBe('rejected');
  });

  it('returns rejected when reject_reason is set', () => {
    expect(deriveStatus({ reject_reason: 'GPA too low' })).toBe('rejected');
  });

  it('returns closed when closed flag is truthy', () => {
    expect(deriveStatus({ closed: true })).toBe('closed');
    expect(deriveStatus({ closed: 'Y' })).toBe('closed');
  });

  it('returns in_progress for an active application', () => {
    expect(deriveStatus({})).toBe('in_progress');
    expect(deriveStatus()).toBe('in_progress');
  });
});

// ─── parseDeadline ─────────────────────────────────────────────────────────
describe('parseDeadline', () => {
  it('returns unknown label for falsy input', () => {
    expect(parseDeadline('')).toMatchObject({
      date: null,
      rolling: false,
      label: 'unknown'
    });
    // @ts-expect-error intentional null
    expect(parseDeadline(null)).toMatchObject({
      date: null,
      rolling: false,
      label: 'unknown'
    });
  });

  it('detects rolling deadlines', () => {
    expect(parseDeadline('2024-Rolling')).toMatchObject({
      date: null,
      rolling: true
    });
    expect(parseDeadline('Rolling admissions')).toMatchObject({
      rolling: true
    });
  });

  it('parses a valid YYYY/MM/DD string', () => {
    const r = parseDeadline('2099/12/31');
    expect(r.date).toBeInstanceOf(Date);
    expect(r.rolling).toBe(false);
    expect(r.label).toBe('2099/12/31');
  });

  it('returns no date for non-3-part strings', () => {
    expect(parseDeadline('WITHDRAW')).toMatchObject({
      date: null,
      rolling: false
    });
    expect(parseDeadline('No Data')).toMatchObject({ date: null });
  });

  it('returns no date when parts are not valid numbers', () => {
    expect(parseDeadline('XXXX/YY/ZZ')).toMatchObject({ date: null });
  });
});

// ─── studentLabel ──────────────────────────────────────────────────────────
describe('studentLabel', () => {
  it('builds a label with name and metadata', () => {
    const s = student('s1', 'Jane', {
      editors: ['e1'],
      applying_program_count: 5,
      createdAt: '2022-03-01T00:00:00.000Z'
    });
    const label = studentLabel(s);
    expect(label.id).toBe('s1');
    expect(typeof label.name).toBe('string');
    expect(label.applyingProgramCount).toBe(5);
    expect(label.joinedAt).toBe('2022-03-01T00:00:00.000Z');
    expect(label.hasEditors).toBe(true);
  });

  it('sets hasEditors false when editors array is empty', () => {
    const label = studentLabel(student('s2', 'Bob', { editors: [] }));
    expect(label.hasEditors).toBe(false);
  });

  it('defaults applyingProgramCount to 0 when absent', () => {
    const s = { _id: 's3', firstname: 'X', editors: [] };
    expect(studentLabel(s).applyingProgramCount).toBe(0);
  });
});

// ─── collectUpcomingDeadlines ──────────────────────────────────────────────
describe('collectUpcomingDeadlines', () => {
  const { application_deadline_V2_calculator } = require('../../../constants');

  it('returns deadlines within the window sorted soonest first', () => {
    application_deadline_V2_calculator.mockImplementation(
      (app: any) => app._deadline
    );
    const byId = new Map([['s1', student('s1')]]);
    const apps = [
      { studentId: 's1', _deadline: '2099/12/31' },
      { studentId: 's1', _deadline: '2099/06/01' }
    ];
    const result = collectUpcomingDeadlines(apps, byId, 99999);
    expect(result.length).toBe(2);
    expect(result[0].daysUntil).toBeLessThan(result[1].daysUntil);
  });

  it('excludes non-in-progress applications', () => {
    application_deadline_V2_calculator.mockReturnValue('2099/12/31');
    const byId = new Map([['s1', student('s1')]]);
    const apps = [
      { studentId: 's1', admission: 'O' }, // admitted
      { studentId: 's1', finalEnrolment: true } // final_enrolled
    ];
    expect(collectUpcomingDeadlines(apps, byId, 99999)).toHaveLength(0);
  });

  it('excludes rolling deadlines', () => {
    application_deadline_V2_calculator.mockReturnValue('2099-Rolling');
    const byId = new Map([['s1', student('s1')]]);
    expect(
      collectUpcomingDeadlines([{ studentId: 's1' }], byId, 99999)
    ).toHaveLength(0);
  });

  it('uses a bare id label when student is not in the map', () => {
    application_deadline_V2_calculator.mockReturnValue('2099/12/31');
    const result = collectUpcomingDeadlines(
      [{ studentId: 's_unknown' }],
      new Map(),
      99999
    );
    expect(result[0].student.id).toBe('s_unknown');
  });

  it('returns empty list for no applications', () => {
    expect(collectUpcomingDeadlines([], new Map(), 30)).toEqual([]);
  });

  it('excludes deadlines outside the window (negative or beyond days)', () => {
    application_deadline_V2_calculator.mockImplementation(
      (app: any) => app._deadline
    );
    const byId = new Map([['s1', student('s1')]]);
    const apps = [
      { studentId: 's1', _deadline: '2000/01/01' }, // past -> daysUntil < 0
      { studentId: 's1', _deadline: '2099/12/31' } // within huge window only if days large
    ];
    const result = collectUpcomingDeadlines(apps, byId, 5); // small window
    expect(result).toHaveLength(0);
  });

  it('flags confirmedElsewhere for finalized students and resolves program name fallback', () => {
    application_deadline_V2_calculator.mockReturnValue('2099/12/31');
    const byId = new Map([['s1', student('s1')]]);
    const apps = [
      { studentId: 's1', programId: { school: 'TU', name: 'CS' } } // program.name fallback (no program_name)
    ];
    const result = collectUpcomingDeadlines(apps, byId, 99999, new Set(['s1']));
    expect(result[0].confirmedElsewhere).toBe(true);
    expect(result[0].program.name).toBe('CS');
  });

  it('includes recently missed deadlines as overdue, but not beyond the lookback', () => {
    application_deadline_V2_calculator.mockImplementation(
      (app: any) => app._deadline
    );
    const ymd = (d: Date) =>
      `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
        d.getDate()
      ).padStart(2, '0')}`;
    const byId = new Map([['s1', student('s1')]]);
    const apps = [
      { studentId: 's1', _deadline: ymd(daysAgo(10)) }, // recently missed
      { studentId: 's1', _deadline: ymd(daysAgo(90)) } // beyond 60d lookback
    ];
    const result = collectUpcomingDeadlines(apps, byId, 30);
    expect(result).toHaveLength(1);
    expect(result[0].overdue).toBe(true);
    expect(result[0].daysUntil).toBeLessThan(0);
  });
});

// ─── collectAdmittedNotConfirmed ───────────────────────────────────────────
describe('collectAdmittedNotConfirmed', () => {
  it('returns admitted applications without final enrolment', () => {
    const byId = new Map([['s1', student('s1', 'Ann')]]);
    const apps = [
      { studentId: 's1', admission: 'O' },
      { studentId: 's1', admission: 'O', finalEnrolment: true },
      { studentId: 's1', admission: 'X' }
    ];
    const result = collectAdmittedNotConfirmed(apps, byId);
    expect(result).toHaveLength(1);
    expect(result[0].student.id).toBe('s1');
  });

  it('handles missing student in map', () => {
    const result = collectAdmittedNotConfirmed(
      [{ studentId: 's9', admission: 'O' }],
      new Map()
    );
    expect(result[0].student.id).toBe('s9');
  });

  it('includes program info with program_name and name fallback', () => {
    const byId = new Map([['s1', student('s1')]]);
    const withProgramName = collectAdmittedNotConfirmed(
      [
        {
          studentId: 's1',
          admission: 'O',
          programId: { school: 'TU', program_name: 'MSc CS' }
        }
      ],
      byId
    );
    expect(withProgramName[0].program).toEqual({
      school: 'TU',
      name: 'MSc CS'
    });

    const withNameFallback = collectAdmittedNotConfirmed(
      [
        {
          studentId: 's1',
          admission: 'O',
          programId: { school: 'TU', name: 'CS' }
        }
      ],
      byId
    );
    expect(withNameFallback[0].program.name).toBe('CS');
  });

  it('returns empty for empty input', () => {
    expect(collectAdmittedNotConfirmed([], new Map())).toEqual([]);
  });
});

// ─── collectMissingBaseDocuments ───────────────────────────────────────────
describe('collectMissingBaseDocuments', () => {
  it('flags students with required documents missing path', () => {
    const s = student('s1', 'Anna', {
      profile: [
        { name: 'Transcript', required: true, path: null },
        { name: 'CV', required: true, path: '/cv.pdf' },
        { name: 'Extra', required: false, path: null }
      ]
    });
    const result = collectMissingBaseDocuments([s]);
    expect(result).toHaveLength(1);
    expect(result[0].missingDocuments).toEqual(['Transcript']);
  });

  it('skips students with all required docs present', () => {
    const s = student('s2', 'Bob', {
      profile: [{ name: 'CV', required: true, path: '/cv.pdf' }]
    });
    expect(collectMissingBaseDocuments([s])).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(collectMissingBaseDocuments([])).toEqual([]);
  });
});

// ─── collectThreadsWaitingOnTeam ───────────────────────────────────────────
describe('collectThreadsWaitingOnTeam', () => {
  it('flags only non-finalized threads whose latest message came from the student, with stall days, worst first', () => {
    const byId = new Map<string, unknown>([
      ['s1', student('s1', 'Ann')],
      ['s4', student('s4', 'Dan')]
    ]);

    const threads = [
      {
        student_id: 's1',
        latest_message_left_by_id: 's1',
        file_type: 'CV',
        isFinalVersion: false,
        updatedAt: daysAgo(14)
      },
      {
        student_id: 's1',
        latest_message_left_by_id: 'editor_x',
        file_type: 'RL',
        isFinalVersion: false,
        updatedAt: daysAgo(2)
      },
      {
        student_id: 's4',
        latest_message_left_by_id: 's4',
        file_type: 'ML',
        isFinalVersion: false,
        updatedAt: daysAgo(40)
      },
      {
        student_id: 's1',
        latest_message_left_by_id: 's1',
        file_type: 'Essay',
        isFinalVersion: true,
        updatedAt: daysAgo(1)
      }
    ];

    const result = collectThreadsWaitingOnTeam(threads, byId);
    expect(result).toHaveLength(2);
    expect(result[0].fileType).toBe('ML');
    expect(result[0].stalledDays).toBe(40);
    expect(result[1].fileType).toBe('CV');
    expect(result[1].stalledDays).toBe(14);
  });

  it('returns an empty list when nothing is waiting on the team', () => {
    expect(collectThreadsWaitingOnTeam([], new Map())).toEqual([]);
  });

  it('flags confirmedElsewhere, falls back lastMsgAt, and uses bare id label when student missing', () => {
    const threads = [
      // finalized student, no student in map -> { id } label; uses lastMsgAt
      {
        student_id: 's9',
        latest_message_left_by_id: 's9',
        file_type: 'CV',
        isFinalVersion: false,
        lastMsgAt: daysAgo(20)
      }
    ];
    const result = collectThreadsWaitingOnTeam(
      threads,
      new Map(),
      new Set(['s9'])
    );
    expect(result).toHaveLength(1);
    expect(result[0].student.id).toBe('s9');
    expect(result[0].confirmedElsewhere).toBe(true);
  });

  it('treats a thread with no message date as 0 stalled days (filtered out)', () => {
    const threads = [
      {
        student_id: 's1',
        latest_message_left_by_id: 's1',
        file_type: 'CV',
        isFinalVersion: false
      }
    ];
    expect(collectThreadsWaitingOnTeam(threads, new Map())).toEqual([]);
  });
});

// ─── collectCommunicationGaps ──────────────────────────────────────────────
describe('collectCommunicationGaps', () => {
  it('flags active students whose unanswered message waited past the threshold, longest first', () => {
    const students = [
      student('s1', 'Ann'),
      student('s2', 'Bob'),
      student('s3', 'Cara'),
      student('s4', 'Dan')
    ];
    const applications = [
      { studentId: 's1' },
      { studentId: 's2' },
      { studentId: 's3', admission: 'O' }, // not in progress
      { studentId: 's4' }
    ];
    // Only students present here have an unanswered message of their own.
    const unanswered = new Map<string, Date>([
      ['s1', daysAgo(30)],
      ['s2', daysAgo(3)], // below threshold
      ['s4', daysAgo(9)]
    ]);

    const result = collectCommunicationGaps(students, applications, unanswered);
    expect(result.map((item) => item.student.id)).toEqual(['s1', 's4']);
    expect(result[0].lastContactDays).toBe(30);
    expect(result[1].lastContactDays).toBe(9);
  });

  it('does not flag students whose latest message was answered (absent from the map)', () => {
    const students = [student('s5', 'Eve')];
    const applications = [{ studentId: 's5' }];
    expect(
      collectCommunicationGaps(students, applications, new Map())
    ).toEqual([]);
  });

  it('does not flag students without an in-progress application', () => {
    const students = [student('s3', 'Cara')];
    const applications = [{ studentId: 's3', finalEnrolment: true }];
    expect(
      collectCommunicationGaps(
        students,
        applications,
        new Map([['s3', daysAgo(30)]])
      )
    ).toEqual([]);
  });
});

// ─── collectStudentSilence ─────────────────────────────────────────────────
describe('collectStudentSilence', () => {
  it('flags active students whose own last message is old, longest silence first', () => {
    const students = [
      student('s1', 'Ann'),
      student('s2', 'Bob'),
      student('s3', 'Cara')
    ];
    const applications = [
      { studentId: 's1' },
      { studentId: 's2' },
      { studentId: 's3' }
    ];
    const lastOwn = new Map<string, Date>([
      ['s1', daysAgo(15)],
      ['s2', daysAgo(40)],
      ['s3', daysAgo(5)] // below threshold
    ]);

    const result = collectStudentSilence(students, applications, lastOwn);
    expect(result.map((item) => item.student.id)).toEqual(['s2', 's1']);
    expect(result[0].silentDays).toBe(40);
    expect(result[1].silentDays).toBe(15);
  });

  it('excludes students who never sent a message (onboarding, not silence)', () => {
    const students = [student('s1', 'Ann')];
    const applications = [{ studentId: 's1' }];
    expect(collectStudentSilence(students, applications, new Map())).toEqual(
      []
    );
  });

  it('excludes students currently waiting on a team reply (gap bucket owns them)', () => {
    const students = [student('s1', 'Ann')];
    const applications = [{ studentId: 's1' }];
    const lastOwn = new Map<string, Date>([['s1', daysAgo(20)]]);
    const unanswered = new Map<string, Date>([['s1', daysAgo(20)]]);
    expect(
      collectStudentSilence(students, applications, lastOwn, unanswered)
    ).toEqual([]);
  });

  it('excludes students without an in-progress application', () => {
    const students = [student('s1', 'Ann')];
    const applications = [{ studentId: 's1', admission: 'X' }];
    const lastOwn = new Map<string, Date>([['s1', daysAgo(20)]]);
    expect(collectStudentSilence(students, applications, lastOwn)).toEqual([]);
  });
});

// ─── buildStudentStats ─────────────────────────────────────────────────────
describe('buildStudentStats', () => {
  it('counts offers and rejections per student', () => {
    const apps = [
      { studentId: 's1', admission: 'O' },
      { studentId: 's1', admission: 'X' },
      { studentId: 's1', admission: 'O' },
      { studentId: 's2', admission: 'X' }
    ];
    const stats = buildStudentStats(apps);
    expect(stats['s1']).toEqual({ offerCount: 2, rejectCount: 1 });
    expect(stats['s2']).toEqual({ offerCount: 0, rejectCount: 1 });
  });

  it('returns empty object for no applications', () => {
    expect(buildStudentStats([])).toEqual({});
  });

  it('ignores applications with no studentId', () => {
    expect(Object.keys(buildStudentStats([{ admission: 'O' }]))).toHaveLength(
      0
    );
  });

  it('ignores non-offer non-reject admissions', () => {
    const stats = buildStudentStats([
      { studentId: 's1', admission: undefined }
    ]);
    expect(stats['s1']).toEqual({ offerCount: 0, rejectCount: 0 });
  });
});

// ─── buildStudentsView ─────────────────────────────────────────────────────
describe('buildStudentsView', () => {
  const emptyCollected = {
    upcomingDeadlines: [],
    threadsWaitingOnTeam: [],
    communicationGaps: [],
    studentSilence: [],
    communicationRiskSignals: [],
    admittedNotConfirmed: [],
    missingBaseDocuments: []
  };

  it('groups a student appearing in several buckets into one record with all signals', () => {
    const label = { id: 's1', name: 'Ann' };
    const collected = {
      ...emptyCollected,
      upcomingDeadlines: [{ student: label, daysUntil: 3, deadline: '2099/01/01' }],
      communicationGaps: [{ student: label, lastContactDays: 20 }],
      missingBaseDocuments: [{ student: label, missingDocuments: ['CV'] }]
    };
    const { students } = buildStudentsView(
      collected,
      { s1: { offerCount: 2, rejectCount: 1 } },
      { s1: ['WS2024'] },
      new Set(),
      200
    );
    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({
      id: 's1',
      offerCount: 2,
      rejectCount: 1,
      applicationTerms: ['WS2024'],
      confirmedElsewhere: false
    });
    expect(students[0].signals.map((s: any) => s.bucket).sort()).toEqual([
      'communicationGaps',
      'missingBaseDocuments',
      'upcomingDeadlines'
    ]);
    // worst signal (deadline in 3 days) => critical overall
    expect(students[0].overallUrgency).toBe('critical');
  });

  it('flags confirmedElsewhere from finalizedStudentIds', () => {
    const collected = {
      ...emptyCollected,
      admittedNotConfirmed: [
        { student: { id: 's1', name: 'Ann' }, program: { school: 'TU' } }
      ]
    };
    const { students } = buildStudentsView(
      collected,
      {},
      {},
      new Set(['s1']),
      200
    );
    expect(students[0].confirmedElsewhere).toBe(true);
    expect(students[0].signals[0].bucket).toBe('admittedNotConfirmed');
  });

  it('caps students at the limit and flags hasMoreStudents', () => {
    const collected = {
      ...emptyCollected,
      communicationGaps: [
        { student: { id: 's1' }, lastContactDays: 30 },
        { student: { id: 's2' }, lastContactDays: 20 }
      ]
    };
    const { students, hasMoreStudents } = buildStudentsView(
      collected,
      {},
      {},
      new Set(),
      1
    );
    expect(students).toHaveLength(1);
    expect(hasMoreStudents).toBe(true);
  });

  it('ignores items without a student id', () => {
    const collected = {
      ...emptyCollected,
      threadsWaitingOnTeam: [{ student: {}, stalledDays: 10, fileType: 'CV' }]
    };
    const { students } = buildStudentsView(collected, {}, {}, new Set(), 200);
    expect(students).toHaveLength(0);
  });

  it('marks overdue deadlines critical and passes the overdue flag through', () => {
    const collected = {
      ...emptyCollected,
      upcomingDeadlines: [
        {
          student: { id: 's1', name: 'Ann' },
          daysUntil: -3,
          overdue: true,
          deadline: '2026/07/02'
        }
      ]
    };
    const { students } = buildStudentsView(collected, {}, {}, new Set(), 200);
    expect(students[0].signals[0]).toMatchObject({
      bucket: 'upcomingDeadlines',
      urgency: 'critical',
      overdue: true,
      daysUntil: -3
    });
  });

  it('maps studentSilence urgency: high past the escalation threshold, else medium', () => {
    const collected = {
      ...emptyCollected,
      studentSilence: [
        { student: { id: 's1', name: 'Ann' }, silentDays: 40 },
        { student: { id: 's2', name: 'Bob' }, silentDays: 12 }
      ]
    };
    const { students } = buildStudentsView(collected, {}, {}, new Set(), 200);
    const byId = new Map(students.map((s: any) => [s.id, s]));
    expect((byId.get('s1') as any).signals[0]).toMatchObject({
      bucket: 'studentSilence',
      urgency: 'high',
      silentDays: 40
    });
    expect((byId.get('s2') as any).signals[0]).toMatchObject({
      bucket: 'studentSilence',
      urgency: 'medium',
      silentDays: 12
    });
  });

  it('derives comm-risk urgency from the capped riskLevel, not raw signal severity', () => {
    const collected = {
      ...emptyCollected,
      communicationRiskSignals: [
        {
          // e.g. a "Done" student whose rollup was capped to low even though
          // an individual signal is high — the cap must hold.
          student: { id: 's1', name: 'Ann' },
          riskLevel: 'low',
          signals: [{ type: 'frustration', severity: 'high' }]
        },
        {
          student: { id: 's2', name: 'Bob' },
          riskLevel: 'high',
          signals: [{ type: 'frustration', severity: 'high' }]
        }
      ]
    };
    const { students } = buildStudentsView(collected, {}, {}, new Set(), 200);
    const byId = new Map(students.map((s: any) => [s.id, s]));
    expect((byId.get('s1') as any).signals[0].urgency).toBe('medium');
    expect((byId.get('s2') as any).signals[0].urgency).toBe('high');
  });
});

// ─── buildFinalizedStudentIds ──────────────────────────────────────────────
describe('buildFinalizedStudentIds', () => {
  it('collects studentIds of applications with truthy finalEnrolment', () => {
    const ids = buildFinalizedStudentIds([
      { studentId: 's1', finalEnrolment: true },
      { studentId: 's2', finalEnrolment: 'O' },
      { studentId: 's3', finalEnrolment: false },
      { studentId: 's4' }
    ]);
    expect(ids.has('s1')).toBe(true);
    expect(ids.has('s2')).toBe(true);
    expect(ids.has('s3')).toBe(false);
    expect(ids.has('s4')).toBe(false);
  });

  it('returns an empty set for falsy / empty input', () => {
    // @ts-expect-error intentional undefined
    expect(buildFinalizedStudentIds(undefined).size).toBe(0);
    expect(buildFinalizedStudentIds([]).size).toBe(0);
  });
});

// ─── buildStudentTerms ─────────────────────────────────────────────────────
describe('buildStudentTerms', () => {
  it('groups distinct sorted semester+year terms per student', () => {
    const terms = buildStudentTerms([
      {
        studentId: 's1',
        application_year: 2024,
        programId: { semester: 'WS' }
      },
      {
        studentId: 's1',
        application_year: 2023,
        programId: { semester: 'SS' }
      },
      { studentId: 's1', application_year: 2024, programId: { semester: 'WS' } } // dup
    ]);
    expect(terms['s1']).toEqual(['SS2023', 'WS2024']);
  });

  it('skips apps missing a semester or year, or studentId', () => {
    const terms = buildStudentTerms([
      { studentId: 's1', application_year: 2024, programId: {} }, // no semester
      { studentId: 's2', programId: { semester: 'WS' } }, // no year
      { application_year: 2024, programId: { semester: 'WS' } } // no studentId
    ]);
    expect(terms).toEqual({});
  });

  it('returns an empty object for falsy / empty input', () => {
    // @ts-expect-error intentional null
    expect(buildStudentTerms(null)).toEqual({});
    expect(buildStudentTerms([])).toEqual({});
  });
});

// ─── loadPortfolio ─────────────────────────────────────────────────────────
describe('loadPortfolio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    DocumentThreadService.getThreadsWaitingOnTeam.mockResolvedValue([]);
  });

  it('returns early with no applications/threads when there are no students', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([]);
    const result = await loadPortfolio({ user: { role: 'Agent' } });
    expect(result.studentIds).toEqual([]);
    expect(result.applications).toEqual([]);
    expect(result.threads).toEqual([]);
    expect(
      ApplicationService.findApplicationsSelectPopulate
    ).not.toHaveBeenCalled();
    expect(
      DocumentThreadService.getThreadsWaitingOnTeam
    ).not.toHaveBeenCalled();
  });

  it('loads applications and threads when students are present', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      student('s1', 'Ann'),
      { id: 's2', firstname: 'Bob' } // uses id (no _id) -> line 111 branch
    ]);
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      { studentId: 's1' }
    ]);
    DocumentThreadService.getThreadsWaitingOnTeam.mockResolvedValue([
      { student_id: 's1' }
    ]);

    const result = await loadPortfolio({ user: { role: 'Agent' } });
    expect(result.studentIds).toContain('s1');
    expect(result.studentIds).toContain('s2');
    expect(result.applications).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
    expect(
      ApplicationService.findApplicationsSelectPopulate
    ).toHaveBeenCalled();
    expect(DocumentThreadService.getThreadsWaitingOnTeam).toHaveBeenCalled();
  });
});

// ─── buildOverview (mocked services) ──────────────────────────────────────
describe('buildOverview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    StudentService.findStudentsSelect.mockResolvedValue([]);
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([]);
    DocumentThreadService.getThreadsWaitingOnTeam.mockResolvedValue([]);
    CommunicationService.getUnansweredStudentMessages.mockResolvedValue([]);
    CommunicationService.getLatestStudentMessageAtForStudents.mockResolvedValue(
      []
    );
  });

  it('returns a structured overview with no students for an empty portfolio', async () => {
    const result = await buildOverview({ user: { role: 'Agent' } });
    expect(result.students).toEqual([]);
    expect(result.hasMoreStudents).toBe(false);
    expect(result.studentCount).toBe(0);
  });

  it('survives when communication service throws', async () => {
    CommunicationService.getUnansweredStudentMessages.mockRejectedValue(
      new Error('DB error')
    );
    const result = await buildOverview({ user: {} });
    expect(result).toHaveProperty('students');
  });

  it('includes role in response', async () => {
    const result = await buildOverview({ user: { role: 'Manager' } });
    expect(result.role).toBe('Manager');
  });

  it('uses the Editor emphasis ordering', async () => {
    const result = await buildOverview({ user: { role: 'Editor' } });
    expect(result.emphasis[0]).toBe('threadsWaitingOnTeam');
  });

  it('honours a custom deadlineWindowDays', async () => {
    const result = await buildOverview(
      { user: { role: 'Agent' } },
      { deadlineWindowDays: 7 }
    );
    expect(result.deadlineWindowDays).toBe(7);
  });

  it('queries only decided, non-withdrawn applications (ignores undecided/withdrawn)', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([student('s1', 'Ann')]);
    await buildOverview({ user: { role: 'Agent' } });
    const [filter] =
      ApplicationService.findApplicationsSelectPopulate.mock.calls[0];
    expect(filter).toMatchObject({ decided: 'O', closed: { $ne: 'X' } });
  });

  it('handles a missing user (undefined role)', async () => {
    const result = await buildOverview({});
    expect(result.role).toBeUndefined();
    expect(result.emphasis[0]).toBe('upcomingDeadlines');
  });

  it('populates message clocks and surfaces communication gaps + silence', async () => {
    StudentService.findStudentsSelect.mockResolvedValue([
      student('s1', 'Ann'),
      student('s2', 'Bob')
    ]);
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      { studentId: 's1' },
      { studentId: 's2' }
    ]);
    CommunicationService.getUnansweredStudentMessages.mockResolvedValue([
      { _id: 's1', latestAt: daysAgo(30) },
      { studentId: 's1', latestAt: 'not-a-date' }, // safeDate -> null, skipped
      { _id: null, latestAt: daysAgo(5) } // no id, skipped
    ]);
    CommunicationService.getLatestStudentMessageAtForStudents.mockResolvedValue(
      [
        { _id: 's1', latestAt: daysAgo(30) }, // waiting on team → gap, not silence
        { _id: 's2', latestAt: daysAgo(15) } // silent
      ]
    );

    const result = await buildOverview({ user: { role: 'Agent' } });
    expect(result.studentCount).toBe(2);
    const buckets = result.students.flatMap((s: any) =>
      s.signals.map((signal: any) => `${s.id}:${signal.bucket}`)
    );
    expect(buckets).toContain('s1:communicationGaps');
    expect(buckets).toContain('s2:studentSilence');
    expect(buckets).not.toContain('s1:studentSilence');
  });
});
