// TokenService is a thin pass-through to TokenDAO (controller -> service ->
// dao). This is a UNIT test: the DAO is mocked so no database (in-memory or
// otherwise) is touched. Each test asserts the service delegates to the right
// DAO method with the exact args and returns the DAO's result.
jest.mock('../../dao/token.dao');

const TokenDAO = require('../../dao/token.dao');
const TokenService = require('../../services/tokens');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TokenService (mocked DAO)', () => {
  it('createToken delegates with payload and returns its result', async () => {
    const payload = { userId: 'u1', token: 'abc123' };
    const daoResult = { _id: 'tok1', ...payload };
    TokenDAO.createToken.mockResolvedValue(daoResult);

    const result = await TokenService.createToken(payload);

    expect(TokenDAO.createToken).toHaveBeenCalledTimes(1);
    expect(TokenDAO.createToken).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('findOneToken delegates with filter and returns its result', async () => {
    const filter = { token: 'abc123' };
    const daoResult = { _id: 'tok1', userId: 'u1', token: 'abc123' };
    TokenDAO.findOneToken.mockResolvedValue(daoResult);

    const result = await TokenService.findOneToken(filter);

    expect(TokenDAO.findOneToken).toHaveBeenCalledTimes(1);
    expect(TokenDAO.findOneToken).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });
});
