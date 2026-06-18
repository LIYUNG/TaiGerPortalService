// Unit tests for services/ai-assist/overview.
// Pure-function helpers and collectors are tested directly.
// buildOverview / loadPortfolio are tested with service mocks.

jest.mock('../../../services/students', () => ({ findStudentsSelect: jest.fn() }));
jest.mock('../../../services/applications', () => ({ findApplicationsSelectPopulate: jest.fn() }));
jest.mock('../../../services/documentthreads', () => ({ findThreadsSelectSorted: jest.fn() }));
jest.mock('../../../services/communications', () => ({ getLatestMessageAtForStudents: jest.fn() }));
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
  collectUpcomingDeadlines,
  collectAdmittedNotConfirmed,
  collectMissingBaseDocuments,
  buildStudentStats,
  enrichBucketItems,
  parseDeadline,
  toIdString,
  safeDate,
  isTruthyFlag,
  deriveStatus,
  studentLabel,
  buildOverview
} = overview as {
  collectThreadsWaitingOnTeam: (threads: any[], studentById: Map<string, any>) => any[];
  collectCommunicationGaps: (students: any[], applications: any[], latestMessageAtById: Map<string, Date>) => any[];
  collectUpcomingDeadlines: (applications: any[], studentById: Map<string, any>, days: number) => any[];
  collectAdmittedNotConfirmed: (applications: any[], studentById: Map<string, any>) => any[];
  collectMissingBaseDocuments: (students: any[]) => any[];
  buildStudentStats: (applications: any[]) => Record<string, { offerCount: number; rejectCount: number }>;
  enrichBucketItems: (bucket: { count: number; items: any[] }, statsById: Record<string, { offerCount: number; rejectCount: number }>) => { count: number; items: any[] };
  parseDeadline: (deadlineString: string) => { date: Date | null; rolling: boolean; label: string };
  toIdString: (value: unknown) => string;
  safeDate: (value: unknown) => Date | null;
  isTruthyFlag: (value: unknown) => boolean;
  deriveStatus: (application?: any) => string;
  studentLabel: (student: any) => any;
  buildOverview: (req: any, opts?: any) => Promise<any>;
};

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n: number): Date => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

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
    expect(parseDeadline('')).toMatchObject({ date: null, rolling: false, label: 'unknown' });
    // @ts-expect-error intentional null
    expect(parseDeadline(null)).toMatchObject({ date: null, rolling: false, label: 'unknown' });
  });

  it('detects rolling deadlines', () => {
    expect(parseDeadline('2024-Rolling')).toMatchObject({ date: null, rolling: true });
    expect(parseDeadline('Rolling admissions')).toMatchObject({ rolling: true });
  });

  it('parses a valid YYYY/MM/DD string', () => {
    const r = parseDeadline('2099/12/31');
    expect(r.date).toBeInstanceOf(Date);
    expect(r.rolling).toBe(false);
    expect(r.label).toBe('2099/12/31');
  });

  it('returns no date for non-3-part strings', () => {
    expect(parseDeadline('WITHDRAW')).toMatchObject({ date: null, rolling: false });
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
    application_deadline_V2_calculator.mockImplementation((app: any) => app._deadline);
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
      { studentId: 's1', admission: 'O' },        // admitted
      { studentId: 's1', finalEnrolment: true }    // final_enrolled
    ];
    expect(collectUpcomingDeadlines(apps, byId, 99999)).toHaveLength(0);
  });

  it('excludes rolling deadlines', () => {
    application_deadline_V2_calculator.mockReturnValue('2099-Rolling');
    const byId = new Map([['s1', student('s1')]]);
    expect(collectUpcomingDeadlines([{ studentId: 's1' }], byId, 99999)).toHaveLength(0);
  });

  it('uses a bare id label when student is not in the map', () => {
    application_deadline_V2_calculator.mockReturnValue('2099/12/31');
    const result = collectUpcomingDeadlines([{ studentId: 's_unknown' }], new Map(), 99999);
    expect(result[0].student.id).toBe('s_unknown');
  });

  it('returns empty list for no applications', () => {
    expect(collectUpcomingDeadlines([], new Map(), 30)).toEqual([]);
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
    const result = collectAdmittedNotConfirmed([{ studentId: 's9', admission: 'O' }], new Map());
    expect(result[0].student.id).toBe('s9');
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
      { student_id: 's1', latest_message_left_by_id: 's1', file_type: 'CV', isFinalVersion: false, updatedAt: daysAgo(14) },
      { student_id: 's1', latest_message_left_by_id: 'editor_x', file_type: 'RL', isFinalVersion: false, updatedAt: daysAgo(2) },
      { student_id: 's4', latest_message_left_by_id: 's4', file_type: 'ML', isFinalVersion: false, updatedAt: daysAgo(40) },
      { student_id: 's1', latest_message_left_by_id: 's1', file_type: 'Essay', isFinalVersion: true, updatedAt: daysAgo(1) }
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
});

// ─── collectCommunicationGaps ──────────────────────────────────────────────
describe('collectCommunicationGaps', () => {
  it('flags active students silent past the threshold or never contacted, longest silence first', () => {
    const students = [
      student('s1', 'Ann'),
      student('s2', 'Bob'),
      student('s3', 'Cara'),
      student('s4', 'Dan')
    ];
    const applications = [
      { studentId: 's1' },
      { studentId: 's2' },
      { studentId: 's3', admission: 'O' },
      { studentId: 's4' }
    ];
    const latest = new Map<string, Date>([
      ['s1', daysAgo(30)],
      ['s2', daysAgo(3)]
    ]);

    const result = collectCommunicationGaps(students, applications, latest);
    expect(result.map((item) => item.student.id)).toEqual(['s4', 's1']);
    expect(result[0].lastContactDays).toBeNull();
    expect(result[1].lastContactDays).toBe(30);
  });

  it('does not flag students without an in-progress application', () => {
    const students = [student('s3', 'Cara')];
    const applications = [{ studentId: 's3', finalEnrolment: true }];
    expect(collectCommunicationGaps(students, applications, new Map())).toEqual([]);
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
    expect(Object.keys(buildStudentStats([{ admission: 'O' }]))).toHaveLength(0);
  });

  it('ignores non-offer non-reject admissions', () => {
    const stats = buildStudentStats([{ studentId: 's1', admission: undefined }]);
    expect(stats['s1']).toEqual({ offerCount: 0, rejectCount: 0 });
  });
});

// ─── enrichBucketItems ─────────────────────────────────────────────────────
describe('enrichBucketItems', () => {
  it('merges offer/reject counts into student labels', () => {
    const b = { count: 1, items: [{ student: { id: 's1', name: 'Ann' } }] };
    const stats = { s1: { offerCount: 2, rejectCount: 1 } };
    const result = enrichBucketItems(b, stats);
    expect(result.count).toBe(1);
    expect(result.items[0].student).toMatchObject({ id: 's1', name: 'Ann', offerCount: 2, rejectCount: 1 });
  });

  it('uses zero defaults when student has no stats', () => {
    const b = { count: 1, items: [{ student: { id: 's9', name: 'X' } }] };
    expect(enrichBucketItems(b, {}).items[0].student).toMatchObject({ offerCount: 0, rejectCount: 0 });
  });

  it('leaves items without a student id untouched', () => {
    const b = { count: 1, items: [{ fileType: 'CV' }] };
    expect(enrichBucketItems(b, { s1: { offerCount: 1, rejectCount: 0 } }).items[0]).toEqual({ fileType: 'CV' });
  });
});

// ─── buildOverview (mocked services) ──────────────────────────────────────
describe('buildOverview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    StudentService.findStudentsSelect.mockResolvedValue([]);
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([]);
    DocumentThreadService.findThreadsSelectSorted.mockResolvedValue([]);
    CommunicationService.getLatestMessageAtForStudents.mockResolvedValue([]);
  });

  it('returns structured overview with empty buckets for no students', async () => {
    const result = await buildOverview({ user: { role: 'Agent' } });
    expect(result).toHaveProperty('buckets');
    expect(result.buckets.upcomingDeadlines.count).toBe(0);
    expect(result.buckets.threadsWaitingOnTeam.count).toBe(0);
    expect(result.studentCount).toBe(0);
  });

  it('survives when communication service throws', async () => {
    CommunicationService.getLatestMessageAtForStudents.mockRejectedValue(new Error('DB error'));
    const result = await buildOverview({ user: {} });
    expect(result).toHaveProperty('buckets');
  });

  it('includes role in response', async () => {
    const result = await buildOverview({ user: { role: 'Manager' } });
    expect(result.role).toBe('Manager');
  });
});
