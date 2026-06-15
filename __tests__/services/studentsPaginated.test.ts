// StudentService.getStudentsPaginated is a thin pass-through to
// StudentDAO.getStudentsPaginated, which owns the pagination/search/sort
// aggregation pipeline. This is a UNIT test: the DAO is mocked so no database
// (in-memory or otherwise) is touched. The real aggregation behaviour (search by
// name, column filters, sorting, agent scoping, page capping) is exercised
// against the DAO/model in the integration suite.
jest.mock('../../dao/student.dao');

const StudentDAO = require('../../dao/student.dao');
const StudentService = require('../../services/students');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('StudentService.getStudentsPaginated (mocked DAO)', () => {
  it('delegates to DAO.getStudentsPaginated with filter+query and returns its result', async () => {
    const filter = { $or: [{ archiv: { $exists: false } }, { archiv: false }] };
    const query = { page: '1', limit: '20', sortBy: 'name_en' };
    const daoResult = {
      students: [{ _id: 's1' }, { _id: 's2' }],
      total: 2,
      page: 1,
      limit: 20
    };
    StudentDAO.getStudentsPaginated.mockResolvedValue(daoResult);

    const result = await StudentService.getStudentsPaginated({ filter, query });

    expect(StudentDAO.getStudentsPaginated).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsPaginated).toHaveBeenCalledWith({
      filter,
      query
    });
    expect(result).toBe(daoResult);
  });

  it('defaults filter and query to empty objects when omitted', async () => {
    const daoResult = { students: [], total: 0, page: 1, limit: 20 };
    StudentDAO.getStudentsPaginated.mockResolvedValue(daoResult);

    const result = await StudentService.getStudentsPaginated({});

    expect(StudentDAO.getStudentsPaginated).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsPaginated).toHaveBeenCalledWith({
      filter: {},
      query: {}
    });
    expect(result).toBe(daoResult);
  });

  it('forwards an agent-scoped filter to the DAO unchanged', async () => {
    const filter = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }],
      agents: 'agent_1'
    };
    const query = { agents: 'agent_1' };
    const daoResult = {
      students: [{ _id: 's1' }],
      total: 1,
      page: 1,
      limit: 20
    };
    StudentDAO.getStudentsPaginated.mockResolvedValue(daoResult);

    const result = await StudentService.getStudentsPaginated({ filter, query });

    expect(StudentDAO.getStudentsPaginated).toHaveBeenCalledWith({
      filter,
      query
    });
    expect(result).toBe(daoResult);
  });
});
