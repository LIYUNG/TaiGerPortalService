// ProgramAIService is a thin pass-through to ProgramAIDAO. This is a UNIT test:
// the DAO is mocked so no database is touched.
jest.mock('../../dao/programAI.dao');

import ProgramAIDAOModule from '../../dao/programAI.dao';
import ProgramAIService from '../../services/programAIs';

// Auto-mocked DAO exposes jest.fn()s at runtime, but TS still sees the real
// signatures. Re-type it as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()` call type-checks.
type MockedDAO = Record<string, jest.Mock>;
const ProgramAIDAO = ProgramAIDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProgramAIService.getByProgramId (mocked DAO)', () => {
  it('delegates to DAO.getByProgramId with programId and returns its result', async () => {
    const programId = 'p1';
    const daoResult = { _id: 'ai1', program: 'p1', summary: 'text' };
    ProgramAIDAO.getByProgramId.mockResolvedValue(daoResult);

    const result = await ProgramAIService.getByProgramId(programId);

    expect(ProgramAIDAO.getByProgramId).toHaveBeenCalledTimes(1);
    expect(ProgramAIDAO.getByProgramId).toHaveBeenCalledWith(programId);
    expect(result).toBe(daoResult);
  });
});
