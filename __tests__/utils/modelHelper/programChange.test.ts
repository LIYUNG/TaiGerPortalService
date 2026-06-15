// Unit tests for utils/modelHelper/programChange.js
//
// The module lazy-requires '../../models' (Documentthread) and
// '../../services/documentthreads' (findStudentDeltaGet). We mock both so no DB
// is touched. asyncHandler wraps the exported functions, but since the wrapper
// is `(req,res,next) => Promise.resolve(handler(req,res,next)).catch(next)`, the
// domain args map straight onto req/res/next and a rejection still propagates to
// the awaiter (next is undefined here), so awaiting these helpers behaves like a
// normal async call.

jest.mock('../../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const mockFind = jest.fn();
const mockSelect = jest.fn();
const mockLean = jest.fn();

jest.mock('../../../models', () => ({
  Documentthread: {
    find: (...args) => mockFind(...args)
  }
}));

const mockFindThreads = jest.fn();
jest.mock('../../../services/documentthreads', () => ({
  findThreads: (...args) => mockFindThreads(...args)
}));

import {
  findStudentDelta,
  findStudentDeltaGet
} from '../../../utils/modelHelper/programChange';

// Helper to build the Documentthread.find().select().lean() chain.
const mockThreadQuery = (threads) => {
  mockLean.mockResolvedValue(threads);
  mockSelect.mockReturnValue({ lean: mockLean });
  mockFind.mockReturnValue({ select: mockSelect });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findStudentDelta (default-connection models)', () => {
  const programId = 'prog-1';
  const studentId = 'stud-1';

  it('adds a missing non-RL thread when program requires it (yes) and none exists', async () => {
    mockThreadQuery([]); // no existing threads
    const program = {
      _id: programId,
      ml_required: 'yes',
      sop_required: 'no'
    };

    const delta = await findStudentDelta(studentId, program);

    expect(mockFind).toHaveBeenCalledWith({
      student_id: studentId,
      program_id: programId
    });
    // ML required -> should be in add
    const addedTypes = delta.add.map((d) => d.fileType);
    expect(addedTypes).toContain('ML');
    // SOP not required -> not added
    expect(addedTypes).not.toContain('SOP');
    expect(delta.remove).toHaveLength(0);
  });

  it('removes an extra non-RL thread when program no longer requires it', async () => {
    mockThreadQuery([
      { file_type: 'ML', messages: [{ a: 1 }], isFinalVersion: false }
    ]);
    const program = {
      _id: programId,
      ml_required: 'no'
    };

    const delta = await findStudentDelta(studentId, program);

    expect(delta.remove).toHaveLength(1);
    expect(delta.remove[0].fileThread.file_type).toBe('ML');
    expect(delta.add).toHaveLength(0);
  });

  // findStudentDelta has exactly 3 params, so the asyncHandler (req,res,next)
  // wrapper DOES forward `options` (the 3rd arg) intact — skipCompleted works
  // here, unlike in the 4-param findStudentDeltaGet / findRLDelta (see below).
  it('skips removal of a completed (final) thread when skipCompleted is set', async () => {
    mockThreadQuery([{ file_type: 'ML', messages: [], isFinalVersion: true }]);
    const program = { _id: programId, ml_required: 'no' };

    const delta = await findStudentDelta(studentId, program, {
      skipCompleted: true
    });

    expect(delta.remove).toHaveLength(0);
  });

  it('computes messageSize and strips messages from threads', async () => {
    const threads = [
      { file_type: 'ML', messages: [{}, {}, {}], isFinalVersion: false }
    ];
    mockThreadQuery(threads);
    const program = { _id: programId, ml_required: 'yes' };

    await findStudentDelta(studentId, program);

    expect(threads[0].messageSize).toBe(3);
    expect(threads[0].messages).toBeUndefined();
  });

  it('returns empty deltas when nothing required and no threads exist', async () => {
    mockThreadQuery([]);
    const program = { _id: programId };

    const delta = await findStudentDelta(studentId, program);

    expect(delta.add).toHaveLength(0);
    expect(delta.remove).toHaveLength(0);
  });

  it('merges RL deltas (add) when specific RLs are required', async () => {
    mockThreadQuery([]); // no existing RL threads
    const program = {
      _id: programId,
      rl_required: '2',
      is_rl_specific: true
    };

    const delta = await findStudentDelta(studentId, program);

    const rlAdds = delta.add.filter((d) => d.fileType.startsWith('RL_'));
    expect(rlAdds).toHaveLength(2);
    expect(rlAdds.map((d) => d.fileType)).toEqual(['RL_A', 'RL_B']);
  });
});

describe('findStudentDeltaGet (service-backed threads)', () => {
  const programId = 'prog-2';
  const studentId = 'stud-2';

  it('uses DocumentThreadService.findThreads and adds missing required threads', async () => {
    mockFindThreads.mockResolvedValue([]);
    const program = { _id: programId, sop_required: 'yes' };

    const delta = await findStudentDeltaGet({}, studentId, program, {});

    expect(mockFindThreads).toHaveBeenCalledWith(
      { student_id: studentId, program_id: programId },
      'file_type messages isFinalVersion'
    );
    expect(delta.add.map((d) => d.fileType)).toContain('SOP');
  });

  // NOTE (dead code): same asyncHandler arg-truncation as findStudentDelta —
  // `options` (4th domain param) never reaches the handler, so skipCompleted is
  // inert and a completed thread is removed regardless.
  it('removes extra threads; skipCompleted is inert through the asyncHandler wrapper', async () => {
    mockFindThreads.mockResolvedValue([
      { file_type: 'SOP', messages: [], isFinalVersion: true }
    ]);
    const program = { _id: programId, sop_required: 'no' };

    const deltaKeep = await findStudentDeltaGet({}, studentId, program, {
      skipCompleted: true
    });
    expect(deltaKeep.remove).toHaveLength(1);

    mockFindThreads.mockResolvedValue([
      { file_type: 'SOP', messages: [], isFinalVersion: false }
    ]);
    const deltaRemove = await findStudentDeltaGet({}, studentId, program, {});
    expect(deltaRemove.remove).toHaveLength(1);
  });

  it('defaults options to {} when omitted', async () => {
    mockFindThreads.mockResolvedValue([]);
    const program = { _id: programId, phs_required: 'yes' };

    const delta = await findStudentDeltaGet({}, studentId, program);

    expect(delta.add.map((d) => d.fileType)).toContain('PHS');
  });
});

describe('findRLDelta (exercised through findStudentDelta)', () => {
  const programId = 'prog-3';
  const studentId = 'stud-3';

  it('does not require RLs when is_rl_specific is false', async () => {
    mockThreadQuery([]);
    const program = {
      _id: programId,
      rl_required: '3',
      is_rl_specific: false
    };

    const delta = await findStudentDelta(studentId, program);

    const rlAdds = delta.add.filter((d) => d.fileType.startsWith('RL_'));
    expect(rlAdds).toHaveLength(0);
  });

  it('treats rl_requirements (no explicit flag) as RL-specific', async () => {
    mockThreadQuery([]);
    const program = {
      _id: programId,
      rl_required: '1',
      rl_requirements: 'some requirement text'
      // is_rl_specific undefined -> NoRLSpecificFlag true -> rl_requirements wins
    };

    const delta = await findStudentDelta(studentId, program);

    const rlAdds = delta.add.filter((d) => d.fileType.startsWith('RL_'));
    expect(rlAdds).toHaveLength(1);
    expect(rlAdds[0].fileType).toBe('RL_A');
  });

  it('caps added RLs at the number of available RL constants', async () => {
    mockThreadQuery([]);
    const program = {
      _id: programId,
      rl_required: '10', // more than the 3 RL constants
      is_rl_specific: true
    };

    const delta = await findStudentDelta(studentId, program);

    const rlAdds = delta.add.filter((d) => d.fileType.startsWith('RL_'));
    // only RL_A, RL_B, RL_C available
    expect(rlAdds).toHaveLength(3);
  });

  it('removes extra specific RLs when fewer are required', async () => {
    mockThreadQuery([
      { file_type: 'RL_A', messages: [], isFinalVersion: false },
      { file_type: 'RL_B', messages: [], isFinalVersion: false }
    ]);
    const program = {
      _id: programId,
      rl_required: '1',
      is_rl_specific: true
    };

    const delta = await findStudentDelta(studentId, program);

    const rlRemoves = delta.remove.filter((d) =>
      d.fileThread.file_type.startsWith('RL_')
    );
    expect(rlRemoves).toHaveLength(1);
  });

  // NOTE (dead code): findRLDelta is also asyncHandler-wrapped and is invoked
  // internally as findRLDelta(program, studentId, threads, options || {}) — the
  // 4th `options` arg is dropped by asyncHandler, so the skipCompleted guard in
  // the extra-RL branch is unreachable; completed RLs are removed anyway.
  it('removes completed specific RLs because skipCompleted never reaches findRLDelta', async () => {
    mockThreadQuery([
      { file_type: 'RL_A', messages: [], isFinalVersion: true },
      { file_type: 'RL_B', messages: [], isFinalVersion: true }
    ]);
    const program = {
      _id: programId,
      rl_required: '0',
      is_rl_specific: true
    };

    const delta = await findStudentDelta(studentId, program, {
      skipCompleted: true
    });

    const rlRemoves = delta.remove.filter((d) =>
      d.fileThread.file_type.startsWith('RL_')
    );
    expect(rlRemoves).toHaveLength(2);
  });

  it('produces no RL delta when required count equals existing count', async () => {
    mockThreadQuery([
      { file_type: 'RL_A', messages: [], isFinalVersion: false }
    ]);
    const program = {
      _id: programId,
      rl_required: '1',
      is_rl_specific: true
    };

    const delta = await findStudentDelta(studentId, program);

    const rlAdds = delta.add.filter((d) => d.fileType.startsWith('RL_'));
    const rlRemoves = delta.remove.filter((d) =>
      d.fileThread.file_type.startsWith('RL_')
    );
    expect(rlAdds).toHaveLength(0);
    expect(rlRemoves).toHaveLength(0);
  });
});
