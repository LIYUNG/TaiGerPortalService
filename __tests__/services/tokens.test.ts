// TokenService delegates to TokenDAO (controller -> service -> dao). This is a
// UNIT test: the DAO is mocked so no database is touched. Each test asserts the
// service delegates to the right DAO method with the exact args and returns the
// DAO's result.
jest.mock('../../dao/token.dao');

import TokenDAOModule from '../../dao/token.dao';
import TokenService from '../../services/tokens';

// Auto-mocked DAO exposes jest.fn()s at runtime, but TS still sees the real
// signatures. Re-type it as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()` calls type-check.
type MockedDAO = Record<string, jest.Mock>;
const TokenDAO = TokenDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TokenService (mocked DAO)', () => {
  it('createToken delegates with the input and returns its result', async () => {
    const input = { userId: 'u1', value: 'abc123' };
    const daoResult = { id: 'tok1', ...input };
    TokenDAO.createToken.mockResolvedValue(daoResult);

    const result = await TokenService.createToken(input);

    expect(TokenDAO.createToken).toHaveBeenCalledTimes(1);
    expect(TokenDAO.createToken).toHaveBeenCalledWith(input);
    expect(result).toBe(daoResult);
  });

  it('findTokenByValue delegates with the value and returns its result', async () => {
    const daoResult = { id: 'tok1', userId: 'u1', value: 'abc123' };
    TokenDAO.findTokenByValue.mockResolvedValue(daoResult);

    const result = await TokenService.findTokenByValue('abc123');

    expect(TokenDAO.findTokenByValue).toHaveBeenCalledTimes(1);
    expect(TokenDAO.findTokenByValue).toHaveBeenCalledWith('abc123');
    expect(result).toBe(daoResult);
  });

  it('deleteTokenById delegates with the id', async () => {
    await TokenService.deleteTokenById('tok1');

    expect(TokenDAO.deleteTokenById).toHaveBeenCalledTimes(1);
    expect(TokenDAO.deleteTokenById).toHaveBeenCalledWith('tok1');
  });
});
