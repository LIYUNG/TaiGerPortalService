// DocumentThreadService composes DocumentthreadDAO and StudentService. This is a
// UNIT test: both the DAO and StudentService are mocked so no database (in-memory
// or otherwise) is touched. Thin delegators assert exact-args + return passthrough.
// The reader methods (getStudentThreadsByStudentId,
// getStudentsThreadsByTaiGerUserId, getAllStudentsThreads) do real JS
// post-filtering on the DAO's returned threads, so those tests assert which
// threads survive the filter.
//
// NOTE: getActiveThreadsPaginated / getActiveThreadsCounts are intentionally not
// covered here — they are exercised by
// __tests__/services/activeThreadsPaginated.test.js.
jest.mock('../../dao/documentthread.dao');
jest.mock('../../services/students');

const DocumentthreadDAO = require('../../dao/documentthread.dao');
const StudentService = require('../../services/students');
const DocumentThreadService = require('../../services/documentthreads');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocumentThreadService — thin DAO delegators (mocked DAO)', () => {
  it('newThread delegates to DAO.newThread', async () => {
    const payload = { file_type: 'ML' };
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.newThread.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.newThread(payload);

    expect(DocumentthreadDAO.newThread).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.newThread).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('countThreads delegates to DAO.countThreads', async () => {
    const filter = { isFinalVersion: false };
    DocumentthreadDAO.countThreads.mockResolvedValue(3);

    const result = await DocumentThreadService.countThreads(filter);

    expect(DocumentthreadDAO.countThreads).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.countThreads).toHaveBeenCalledWith(filter);
    expect(result).toBe(3);
  });

  it('createThread delegates to DAO.createThread', async () => {
    const payload = { file_type: 'Essay' };
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.createThread.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.createThread(payload);

    expect(DocumentthreadDAO.createThread).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.createThread).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('deleteThreadById delegates to DAO.deleteThreadById', async () => {
    const daoResult = { deletedCount: 1 };
    DocumentthreadDAO.deleteThreadById.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.deleteThreadById('t1');

    expect(DocumentthreadDAO.deleteThreadById).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.deleteThreadById).toHaveBeenCalledWith('t1');
    expect(result).toBe(daoResult);
  });

  it('updateThreadFields delegates to DAO.updateThreadFields', async () => {
    const payload = { isFinalVersion: true };
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.updateThreadFields.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.updateThreadFields(
      't1',
      payload
    );

    expect(DocumentthreadDAO.updateThreadFields).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.updateThreadFields).toHaveBeenCalledWith(
      't1',
      payload
    );
    expect(result).toBe(daoResult);
  });

  it('getThreadByIdLean delegates to DAO.getThreadByIdLean', async () => {
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.getThreadByIdLean.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getThreadByIdLean('t1');

    expect(DocumentthreadDAO.getThreadByIdLean).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.getThreadByIdLean).toHaveBeenCalledWith('t1');
    expect(result).toBe(daoResult);
  });

  it('findThreads delegates to DAO.findThreads', async () => {
    const filter = { student_id: 's1' };
    const daoResult = [{ _id: 't1' }];
    DocumentthreadDAO.findThreads.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.findThreads(filter, 'file_type');

    expect(DocumentthreadDAO.findThreads).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findThreads).toHaveBeenCalledWith(
      filter,
      'file_type'
    );
    expect(result).toBe(daoResult);
  });

  it('findThreadsSelectSorted delegates to DAO.findThreadsSelectSorted', async () => {
    const filter = { student_id: 's1' };
    const sort = { updatedAt: -1 };
    const daoResult = [{ _id: 't1' }];
    DocumentthreadDAO.findThreadsSelectSorted.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.findThreadsSelectSorted(
      filter,
      'file_type',
      sort
    );

    expect(DocumentthreadDAO.findThreadsSelectSorted).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findThreadsSelectSorted).toHaveBeenCalledWith(
      filter,
      'file_type',
      sort
    );
    expect(result).toBe(daoResult);
  });

  it('getThreadDocById delegates to DAO.getThreadDocById', async () => {
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.getThreadDocById.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getThreadDocById('t1');

    expect(DocumentthreadDAO.getThreadDocById).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.getThreadDocById).toHaveBeenCalledWith('t1');
    expect(result).toBe(daoResult);
  });

  it('getThreadDocByIdPopulated delegates to DAO.getThreadDocByIdPopulated', async () => {
    const populates = [{ path: 'student_id' }];
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.getThreadDocByIdPopulated.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getThreadDocByIdPopulated(
      't1',
      populates
    );

    expect(DocumentthreadDAO.getThreadDocByIdPopulated).toHaveBeenCalledTimes(
      1
    );
    expect(DocumentthreadDAO.getThreadDocByIdPopulated).toHaveBeenCalledWith(
      't1',
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('findThreadByIdPopulated delegates to DAO.findThreadByIdPopulated', async () => {
    const populates = [{ path: 'student_id' }];
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.findThreadByIdPopulated.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.findThreadByIdPopulated(
      't1',
      populates
    );

    expect(DocumentthreadDAO.findThreadByIdPopulated).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findThreadByIdPopulated).toHaveBeenCalledWith(
      't1',
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('findOneThreadPopulated delegates to DAO.findOneThreadPopulated', async () => {
    const filter = { student_id: 's1' };
    const populates = [{ path: 'student_id' }];
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.findOneThreadPopulated.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.findOneThreadPopulated(
      filter,
      populates
    );

    expect(DocumentthreadDAO.findOneThreadPopulated).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findOneThreadPopulated).toHaveBeenCalledWith(
      filter,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('findOneThreadDoc delegates to DAO.findOneThreadDoc', async () => {
    const filter = { student_id: 's1' };
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.findOneThreadDoc.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.findOneThreadDoc(filter);

    expect(DocumentthreadDAO.findOneThreadDoc).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findOneThreadDoc).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('clearAllOutsourcedUsers delegates to DAO.clearAllOutsourcedUsers', async () => {
    const daoResult = { acknowledged: true };
    DocumentthreadDAO.clearAllOutsourcedUsers.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.clearAllOutsourcedUsers();

    expect(DocumentthreadDAO.clearAllOutsourcedUsers).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.clearAllOutsourcedUsers).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('setMessageIgnore delegates to DAO.setMessageIgnore', async () => {
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.setMessageIgnore.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.setMessageIgnore('m1', true);

    expect(DocumentthreadDAO.setMessageIgnore).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.setMessageIgnore).toHaveBeenCalledWith('m1', true);
    expect(result).toBe(daoResult);
  });

  it('createApplicationThread delegates to DAO with the three args', async () => {
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.createApplicationThread.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.createApplicationThread(
      's1',
      'app1',
      'RL'
    );

    expect(DocumentthreadDAO.createApplicationThread).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.createApplicationThread).toHaveBeenCalledWith(
      's1',
      'app1',
      'RL'
    );
    expect(result).toBe(daoResult);
  });

  it('getThreadById delegates to DAO.findThreadByIdFullyPopulated', async () => {
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.findThreadByIdFullyPopulated.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getThreadById('t1');

    expect(
      DocumentthreadDAO.findThreadByIdFullyPopulated
    ).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findThreadByIdFullyPopulated).toHaveBeenCalledWith(
      't1'
    );
    expect(result).toBe(daoResult);
  });

  it('getThreads delegates to DAO.findThreadsPopulated', async () => {
    const filter = { student_id: 's1' };
    const daoResult = [{ _id: 't1' }];
    DocumentthreadDAO.findThreadsPopulated.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getThreads(filter);

    expect(DocumentthreadDAO.findThreadsPopulated).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.findThreadsPopulated).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('updateThreadById delegates to DAO.updateThreadByIdReturnNew', async () => {
    const payload = { isFinalVersion: true };
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.updateThreadByIdReturnNew.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.updateThreadById('t1', payload);

    expect(DocumentthreadDAO.updateThreadByIdReturnNew).toHaveBeenCalledTimes(
      1
    );
    expect(DocumentthreadDAO.updateThreadByIdReturnNew).toHaveBeenCalledWith(
      't1',
      payload
    );
    expect(result).toBe(daoResult);
  });

  it('updateThread delegates to DAO.updateOneThreadReturnNew', async () => {
    const filter = { _id: 't1' };
    const payload = { isFinalVersion: true };
    const daoResult = { _id: 't1' };
    DocumentthreadDAO.updateOneThreadReturnNew.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.updateThread(filter, payload);

    expect(DocumentthreadDAO.updateOneThreadReturnNew).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.updateOneThreadReturnNew).toHaveBeenCalledWith(
      filter,
      payload
    );
    expect(result).toBe(daoResult);
  });
});

describe('DocumentThreadService.getStudentThreadsByStudentId (post-filtering)', () => {
  it('keeps only decided==="O" (or no application) and non-Interview threads', async () => {
    const threads = [
      { _id: 't1', file_type: 'ML', application_id: { decided: 'O' } }, // keep
      { _id: 't2', file_type: 'CV' }, // keep (no application)
      { _id: 't3', file_type: 'ML', application_id: { decided: '-' } }, // drop: not decided
      { _id: 't4', file_type: 'Interview', application_id: { decided: 'O' } } // drop: Interview
    ];
    DocumentthreadDAO.findThreadsByStudentIdPopulated.mockResolvedValue(
      threads
    );

    const result = await DocumentThreadService.getStudentThreadsByStudentId(
      's1'
    );

    expect(
      DocumentthreadDAO.findThreadsByStudentIdPopulated
    ).toHaveBeenCalledWith('s1');
    expect(result.map((t) => t._id)).toEqual(['t1', 't2']);
  });
});

describe('DocumentThreadService.getStudentsThreadsByTaiGerUserId (post-filtering)', () => {
  const userId = 'agent1';

  const agentStudent = (overrides = {}) => ({
    agents: [{ _id: { toString: () => 'agent1' } }],
    editors: [],
    archiv: false,
    ...overrides
  });

  it('keeps threads where the user is an agent of an active student, decided==="O", non-Interview', async () => {
    const threads = [
      {
        _id: 't1',
        file_type: 'ML',
        student_id: agentStudent(),
        application_id: { decided: 'O' }
      }, // keep
      {
        _id: 't2',
        file_type: 'CV',
        student_id: agentStudent() // no application -> keep
      },
      {
        _id: 't3',
        file_type: 'ML',
        student_id: {
          agents: [{ _id: { toString: () => 'someone-else' } }],
          editors: []
        },
        application_id: { decided: 'O' }
      }, // drop: user not agent/editor
      {
        _id: 't4',
        file_type: 'Interview',
        student_id: agentStudent(),
        application_id: { decided: 'O' }
      }, // drop: Interview
      {
        _id: 't5',
        file_type: 'ML',
        student_id: agentStudent({ archiv: true }),
        application_id: { decided: 'O' }
      } // drop: archived student
    ];
    DocumentthreadDAO.findThreadsForTaiGerUserPopulated.mockResolvedValue(
      threads
    );

    const result = await DocumentThreadService.getStudentsThreadsByTaiGerUserId(
      userId,
      {
        x: 1
      }
    );

    expect(
      DocumentthreadDAO.findThreadsForTaiGerUserPopulated
    ).toHaveBeenCalledWith({ x: 1 });
    expect(result.map((t) => t._id)).toEqual(['t1', 't2']);
  });

  it('keeps an Essay thread when the user is in outsourced_user_id', async () => {
    const threads = [
      {
        _id: 't1',
        file_type: 'Essay',
        student_id: { agents: [], editors: [], archiv: false },
        outsourced_user_id: [{ _id: { toString: () => 'agent1' } }],
        application_id: { decided: 'O' }
      }
    ];
    DocumentthreadDAO.findThreadsForTaiGerUserPopulated.mockResolvedValue(
      threads
    );

    const result = await DocumentThreadService.getStudentsThreadsByTaiGerUserId(
      userId
    );

    expect(
      DocumentthreadDAO.findThreadsForTaiGerUserPopulated
    ).toHaveBeenCalledWith({});
    expect(result.map((t) => t._id)).toEqual(['t1']);
  });
});

describe('DocumentThreadService.getAllStudentsThreads (active students + post-filtering)', () => {
  it('scopes to active student ids and keeps decided==="O"/non-Interview threads', async () => {
    StudentService.fetchSimpleStudents.mockResolvedValue([
      { _id: 's1' },
      { _id: 's2' }
    ]);
    const threads = [
      { _id: 't1', file_type: 'ML', application_id: { decided: 'O' } }, // keep
      { _id: 't2', file_type: 'CV' }, // keep
      { _id: 't3', file_type: 'Interview', application_id: { decided: 'O' } }, // drop
      { _id: 't4', file_type: 'ML', application_id: { decided: '-' } } // drop
    ];
    DocumentthreadDAO.findAllStudentsThreadsPopulated.mockResolvedValue(
      threads
    );

    const result = await DocumentThreadService.getAllStudentsThreads({
      file_type: 'ML'
    });

    // active-student lookup
    expect(StudentService.fetchSimpleStudents).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    // query merged with student_id $in scope
    expect(
      DocumentthreadDAO.findAllStudentsThreadsPopulated
    ).toHaveBeenCalledWith({
      file_type: 'ML',
      student_id: { $in: ['s1', 's2'] }
    });
    expect(result.map((t) => t._id)).toEqual(['t1', 't2']);
  });
});
