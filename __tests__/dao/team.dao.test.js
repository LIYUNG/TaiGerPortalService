// TeamDAO unit tests — the DAO is a read-only analytics layer over several
// Mongoose models, so we mock the models entirely (NO database). Aggregations
// are asserted on forwarded-call + returned-result only; pipeline-internal
// behaviour is covered by the integration suite.
jest.mock('../../models', () => ({
  Application: { aggregate: jest.fn() },
  User: { aggregate: jest.fn() },
  Student: { aggregate: jest.fn() },
  Interval: { find: jest.fn() },
  ResponseTime: { find: jest.fn(), aggregate: jest.fn() },
  Documentthread: { find: jest.fn() }
}));

const {
  Application,
  User,
  Student,
  Interval,
  ResponseTime,
  Documentthread
} = require('../../models');
const TeamDAO = require('../../dao/team.dao');

// A query chain that is both thenable (resolves to `value` for queries not
// ending in .lean()) and chainable (populate/select/lean compose).
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TeamDAO (mocked models)', () => {
  it('getActivePrograms runs an Application aggregation and returns the result', async () => {
    const rows = [{ _id: 'p1', count: 3 }];
    Application.aggregate.mockResolvedValue(rows);

    const result = await TeamDAO.getActivePrograms();

    expect(Application.aggregate).toHaveBeenCalledTimes(1);
    expect(Array.isArray(Application.aggregate.mock.calls[0][0])).toBe(true);
    expect(result).toBe(rows);
  });

  it('getTeamMembers runs a User aggregation and returns the result', async () => {
    const rows = [{ _id: 'u1' }];
    User.aggregate.mockResolvedValue(rows);

    const result = await TeamDAO.getTeamMembers();

    expect(User.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getGeneralTasks runs a Student aggregation and returns the result', async () => {
    const rows = [{ _id: 't1' }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await TeamDAO.getGeneralTasks();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getDecidedApplicationsTasks runs a Student aggregation and returns the result', async () => {
    const rows = [{ _id: 't2' }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await TeamDAO.getDecidedApplicationsTasks();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getFileTypeCounts runs two Student aggregations and returns both counts', async () => {
    const counts1 = [{ _id: 'CV', count: 2 }];
    const counts2 = [{ _id: 'ML', count: 5 }];
    Student.aggregate
      .mockResolvedValueOnce(counts1)
      .mockResolvedValueOnce(counts2);

    const result = await TeamDAO.getFileTypeCounts();

    expect(Student.aggregate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ counts1, counts2 });
  });

  it('getAgentStudentDistData runs two Student aggregations and returns both buckets', async () => {
    const admission = [{ count: 1 }];
    const noAdmission = [{ count: 4 }];
    Student.aggregate
      .mockResolvedValueOnce(admission)
      .mockResolvedValueOnce(noAdmission);

    const result = await TeamDAO.getAgentStudentDistData('agent1');

    expect(Student.aggregate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ admission, noAdmission });
  });

  it('getEditorTaskRows merges Student + Application aggregations into one array', async () => {
    const generalTasks = [{ _id: 'g1' }];
    const applicationTasks = [{ _id: 'a1' }];
    Student.aggregate.mockResolvedValue(generalTasks);
    Application.aggregate.mockResolvedValue(applicationTasks);

    const result = await TeamDAO.getEditorTaskRows();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(Application.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toEqual([...generalTasks, ...applicationTasks]);
  });

  it('getStudentsCreationData runs a Student aggregation and returns the result', async () => {
    const rows = [{ createdAt: 'x' }];
    Student.aggregate.mockResolvedValue(rows);

    const result = await TeamDAO.getStudentsCreationData();

    expect(Student.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getStudentAvgResponseTime runs a ResponseTime aggregation and returns the result', async () => {
    const rows = [{ _id: 's1' }];
    ResponseTime.aggregate.mockResolvedValue(rows);

    const result = await TeamDAO.getStudentAvgResponseTime();

    expect(ResponseTime.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(rows);
  });

  it('getKpiFinishedDocs filters, populates, selects and returns the lean docs', async () => {
    const docs = [{ _id: 'd1' }];
    const chain = queryChain(docs);
    Documentthread.find.mockReturnValue(chain);

    const result = await TeamDAO.getKpiFinishedDocs();

    const usedFilter = Documentthread.find.mock.calls[0][0];
    expect(usedFilter).toHaveProperty('isFinalVersion', true);
    expect(usedFilter).toHaveProperty('$or');
    expect(chain.populate).toHaveBeenCalledWith(
      'student_id',
      'firstname lastname'
    );
    expect(chain.select).toHaveBeenCalledWith('file_type messages.createdAt');
    expect(result).toBe(docs);
  });

  it('getResponseTimesByStudent queries by student_id and returns the docs', async () => {
    const docs = [{ _id: 'r1' }];
    ResponseTime.find.mockReturnValue(queryChain(docs));

    const result = await TeamDAO.getResponseTimesByStudent('stu1');

    expect(ResponseTime.find).toHaveBeenCalledWith({ student_id: 'stu1' });
    expect(result).toEqual(docs);
  });

  it('getIntervals filters, selects and returns the lean docs', async () => {
    const filter = { interval_type: 'X' };
    const docs = [{ intervalAvg: 1 }];
    const chain = queryChain(docs);
    Interval.find.mockReturnValue(chain);

    const result = await TeamDAO.getIntervals(filter);

    expect(Interval.find).toHaveBeenCalledWith(filter);
    expect(chain.select).toHaveBeenCalledWith('-updatedAt -_id -student_id');
    expect(result).toBe(docs);
  });
});
