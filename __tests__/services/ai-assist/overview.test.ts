// Unit tests for the rule-based portfolio risk collectors in
// services/ai-assist/overview. These are pure functions over already-fetched
// data — no DB or service mocking required.

import overview from '../../../services/ai-assist/overview';

const { collectThreadsWaitingOnTeam, collectCommunicationGaps } = overview as {
  collectThreadsWaitingOnTeam: (threads: unknown[], studentById: Map<string, unknown>) => any[];
  collectCommunicationGaps: (
    students: unknown[],
    applications: unknown[],
    latestMessageAtById: Map<string, Date>
  ) => any[];
};

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const student = (id: string, firstname: string) => ({
  _id: id,
  firstname,
  email: `${id}@example.com`
});

describe('collectThreadsWaitingOnTeam', () => {
  it('flags only non-finalized threads whose latest message came from the student, with stall days, worst first', () => {
    const byId = new Map<string, unknown>([
      ['s1', student('s1', 'Ann')],
      ['s4', student('s4', 'Dan')]
    ]);

    const threads = [
      // waiting on team 14 days
      {
        student_id: 's1',
        latest_message_left_by_id: 's1',
        file_type: 'CV',
        isFinalVersion: false,
        updatedAt: daysAgo(14)
      },
      // latest message from an editor -> NOT waiting on team
      {
        student_id: 's1',
        latest_message_left_by_id: 'editor_x',
        file_type: 'RL',
        isFinalVersion: false,
        updatedAt: daysAgo(2)
      },
      // waiting on team 40 days
      {
        student_id: 's4',
        latest_message_left_by_id: 's4',
        file_type: 'ML',
        isFinalVersion: false,
        updatedAt: daysAgo(40)
      },
      // finalized -> excluded
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
    // Most-stalled first.
    expect(result[0].fileType).toBe('ML');
    expect(result[0].stalledDays).toBe(40);
    expect(result[1].fileType).toBe('CV');
    expect(result[1].stalledDays).toBe(14);
  });

  it('returns an empty list when nothing is waiting on the team', () => {
    expect(collectThreadsWaitingOnTeam([], new Map())).toEqual([]);
  });
});

describe('collectCommunicationGaps', () => {
  it('flags active students silent past the threshold or never contacted, longest silence first', () => {
    const students = [
      student('s1', 'Ann'), // 30d silent, active -> flagged
      student('s2', 'Bob'), // 3d silent, active -> not flagged
      student('s3', 'Cara'), // admitted (not active) -> not flagged
      student('s4', 'Dan') // never contacted, active -> flagged, sorts first
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

    expect(
      collectCommunicationGaps(students, applications, new Map())
    ).toEqual([]);
  });
});
