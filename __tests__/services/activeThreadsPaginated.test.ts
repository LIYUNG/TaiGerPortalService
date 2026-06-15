// DocumentThreadService active-thread reads are thin pass-throughs to
// DocumentthreadDAO, which owns the aggregation pipeline. This is a UNIT test:
// the DAO is mocked so no database (in-memory or otherwise) is touched. The real
// aggregation behaviour is exercised end-to-end by the integration suite
// (__tests__/integration/documentthread.test.js, "overview/all" happy path).
jest.mock('../../dao/documentthread.dao');

import DocumentthreadDAO from '../../dao/documentthread.dao';
import DocumentThreadService from '../../services/documentthreads';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocumentThreadService.getActiveThreadsPaginated (mocked DAO)', () => {
  it('delegates to DAO.findActiveThreadsPaginated and returns its result', async () => {
    const params = {
      studentIds: ['s1', 's2'],
      outsourcedUserId: null,
      query: { category: 'in_progress' }
    };
    const daoResult = {
      threads: [{ file_type: 'ML' }],
      total: 1,
      page: 1,
      limit: 20
    };
    DocumentthreadDAO.findActiveThreadsPaginated.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getActiveThreadsPaginated(
      params
    );

    expect(DocumentthreadDAO.findActiveThreadsPaginated).toHaveBeenCalledTimes(
      1
    );
    expect(DocumentthreadDAO.findActiveThreadsPaginated).toHaveBeenCalledWith(
      params
    );
    expect(result).toBe(daoResult);
  });
});

describe('DocumentThreadService.getActiveThreadsCounts (mocked DAO)', () => {
  it('delegates to DAO.countActiveThreads and returns its result', async () => {
    const params = {
      studentIds: ['s1'],
      outsourcedUserId: 'agent1',
      query: { viewerId: 'agent1' }
    };
    const daoResult = {
      all: 2,
      closed: 0,
      in_progress: 1,
      no_input: 1
    };
    DocumentthreadDAO.countActiveThreads.mockResolvedValue(daoResult);

    const result = await DocumentThreadService.getActiveThreadsCounts(params);

    expect(DocumentthreadDAO.countActiveThreads).toHaveBeenCalledTimes(1);
    expect(DocumentthreadDAO.countActiveThreads).toHaveBeenCalledWith(params);
    expect(result).toBe(daoResult);
  });
});
