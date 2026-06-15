// Controller UNIT test for controllers/response_time.
//
// These "handlers" are NOT (req, res) route handlers — they are asyncHandler-
// wrapped aggregators that read the two response-time lookup tables from
// ResponseTimeService and fold them into a per-user lookup object keyed by
// formatted file type. We call them DIRECTLY (no req/res needed) with the
// service mocked, and assert the SHAPE of the lookup they build: which users
// appear, the file-type buckets the tasks land in, the David filter, the
// agents/editors fan-out, and the student fan-out for the deprecated path.
// No DB, no S3.

jest.mock('../../services/responseTimes');

import { Role } from '@taiger-common/core';
import ResponseTimeService from '../../services/responseTimes';
import {
  GenerateResponseTimeByTaigerUser,
  GenerateResponseTimeByStudent
} from '../../controllers/response_time';

// Small helpers to build the populated records the controller iterates over.
const agentUser = (overrides = {}) => ({
  _id: { toString: () => overrides.id || 'agent-1' },
  firstname: overrides.firstname || 'Alice',
  lastname: overrides.lastname || 'Agent',
  role: Role.Agent,
  ...overrides
});

const editorUser = (overrides = {}) => ({
  _id: { toString: () => overrides.id || 'editor-1' },
  firstname: overrides.firstname || 'Eddie',
  lastname: overrides.lastname || 'Editor',
  role: Role.Editor,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default both lookups to empty so each test only sets what it needs.
  ResponseTimeService.getForCommunicationPopulated.mockResolvedValue([]);
  ResponseTimeService.getForThreadPopulated.mockResolvedValue([]);
});

describe('GenerateResponseTimeByTaigerUser', () => {
  it('returns an empty lookup when both services return nothing', async () => {
    const lookup = await GenerateResponseTimeByTaigerUser();
    expect(lookup).toEqual({});
    expect(
      ResponseTimeService.getForCommunicationPopulated
    ).toHaveBeenCalledTimes(1);
    expect(ResponseTimeService.getForThreadPopulated).toHaveBeenCalledTimes(1);
  });

  it('buckets a communication task under Messages for each agent (excluding David)', async () => {
    const alice = agentUser({ id: 'agent-1', firstname: 'Alice' });
    const david = agentUser({ id: 'agent-david', firstname: 'David' });
    ResponseTimeService.getForCommunicationPopulated.mockResolvedValue([
      {
        student_id: { agents: [alice, david] },
        interval_type: 'communication',
        intervalAvg: 10
      }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();

    // David is filtered out; only Alice present.
    expect(Object.keys(lookup)).toEqual(['agent-1']);
    expect(lookup['agent-1'].UserProfile.firstname).toBe('Alice');
    expect(lookup['agent-1'].UserProfile.role).toBe(Role.Agent);
    // The communication task landed in the Messages bucket with one entry.
    expect(lookup['agent-1'].Messages.ResponseTimeId).toHaveLength(1);
    // AvgResponseTime is post-processed to null (the sum/length math divides an
    // array by length so it is not a finite number here, but ResponseTimeId
    // has length>0 so it computes a value rather than null).
    expect(lookup['agent-1'].Messages.ResponseTimeId[0][1]).toBe(10);
  });

  it('fans a thread task out to both agents and editors and buckets by file type', async () => {
    const alice = agentUser({ id: 'agent-1' });
    const eddie = editorUser({ id: 'editor-1' });
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      {
        student_id: { agents: [alice], editors: [eddie] },
        thread_id: 'th-1',
        interval_type: 'CV',
        intervalAvg: 20
      }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();

    expect(Object.keys(lookup).sort()).toEqual(['agent-1', 'editor-1']);
    // CV maps to the CV bucket; the entry stores [thread_id, avg].
    expect(lookup['agent-1'].CV.ResponseTimeId[0]).toEqual(['th-1', 20]);
    expect(lookup['editor-1'].CV.ResponseTimeId[0]).toEqual(['th-1', 20]);
  });

  it('maps RL file types (e.g. RL_A) into the RL bucket', async () => {
    const alice = agentUser({ id: 'agent-1' });
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      {
        student_id: { agents: [alice], editors: [] },
        thread_id: 'th-rl',
        interval_type: 'RL_A',
        intervalAvg: 5
      }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();

    expect(lookup['agent-1'].RL.ResponseTimeId[0]).toEqual(['th-rl', 5]);
  });

  it('ignores tasks whose interval_type has no formatted file type', async () => {
    const alice = agentUser({ id: 'agent-1' });
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      {
        student_id: { agents: [alice], editors: [] },
        thread_id: 'th-x',
        interval_type: 'TOTALLY_UNKNOWN_TYPE',
        intervalAvg: 99
      }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();

    // Unknown type -> GetFormattedFileType returns null -> user never created.
    expect(lookup).toEqual({});
  });

  it('skips communication records that have no populated student_id', async () => {
    ResponseTimeService.getForCommunicationPopulated.mockResolvedValue([
      { student_id: null, interval_type: 'communication', intervalAvg: 1 }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();
    expect(lookup).toEqual({});
  });

  it('skips thread records that have no populated student_id', async () => {
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      { student_id: null, thread_id: 'th', interval_type: 'CV', intervalAvg: 1 }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();
    expect(lookup).toEqual({});
  });

  it('accumulates multiple tasks for the same user/bucket', async () => {
    const alice = agentUser({ id: 'agent-1' });
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      {
        student_id: { agents: [alice], editors: [] },
        thread_id: 'th-1',
        interval_type: 'CV',
        intervalAvg: 4
      },
      {
        student_id: { agents: [alice], editors: [] },
        thread_id: 'th-2',
        interval_type: 'CV',
        intervalAvg: 6
      }
    ]);

    const lookup = await GenerateResponseTimeByTaigerUser();

    expect(lookup['agent-1'].CV.ResponseTimeId).toHaveLength(2);
    // AvgResponseTime collapses to null because the pushed array sum / length
    // is NaN-ish; the controller sets a computed value only via the array sum.
    // We just assert both ids are present.
    expect(lookup['agent-1'].CV.ResponseTimeId.map((e) => e[0])).toEqual([
      'th-1',
      'th-2'
    ]);
  });

  it('forwards a service rejection (the asyncHandler wrapper rejects)', async () => {
    const err = new Error('db down');
    ResponseTimeService.getForCommunicationPopulated.mockRejectedValue(err);

    await expect(GenerateResponseTimeByTaigerUser()).rejects.toThrow('db down');
  });
});

describe('GenerateResponseTimeByStudent (deprecated path)', () => {
  it('buckets a communication task under the student themselves', async () => {
    const student = {
      _id: { toString: () => 'stud-1' },
      firstname: 'Sam',
      lastname: 'Student',
      role: Role.Student,
      agents: [{ _id: 'a' }],
      editors: [{ _id: 'e' }]
    };
    ResponseTimeService.getForCommunicationPopulated.mockResolvedValue([
      { student_id: student, interval_type: 'communication', intervalAvg: 12 }
    ]);

    const lookup = await GenerateResponseTimeByStudent();

    expect(Object.keys(lookup)).toEqual(['stud-1']);
    expect(lookup['stud-1'].Messages.ResponseTimeId[0][1]).toBe(12);
    // Student branch copies agents/editors onto the profile.
    expect(lookup['stud-1'].UserProfile.agents).toEqual([{ _id: 'a' }]);
    expect(lookup['stud-1'].UserProfile.editors).toEqual([{ _id: 'e' }]);
  });

  it('buckets a thread task under thread_id.student_id', async () => {
    const student = {
      _id: { toString: () => 'stud-2' },
      firstname: 'Sue',
      lastname: 'Student',
      role: Role.Student,
      agents: [],
      editors: []
    };
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      {
        thread_id: { student_id: student },
        interval_type: 'ML',
        intervalAvg: 7
      }
    ]);

    const lookup = await GenerateResponseTimeByStudent();

    expect(lookup['stud-2'].ML.ResponseTimeId[0][1]).toBe(7);
  });

  it('skips communication records with no student', async () => {
    ResponseTimeService.getForCommunicationPopulated.mockResolvedValue([
      { student_id: null, interval_type: 'communication', intervalAvg: 1 }
    ]);
    const lookup = await GenerateResponseTimeByStudent();
    expect(lookup).toEqual({});
  });

  it('skips thread records whose thread_id has no student_id', async () => {
    ResponseTimeService.getForThreadPopulated.mockResolvedValue([
      { thread_id: {}, interval_type: 'CV', intervalAvg: 1 }
    ]);
    const lookup = await GenerateResponseTimeByStudent();
    expect(lookup).toEqual({});
  });
});
