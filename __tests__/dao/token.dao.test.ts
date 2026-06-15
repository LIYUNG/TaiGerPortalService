// TokenDAO unit tests — the DAO is a thin layer over the Token Mongoose model,
// so we mock the model entirely (NO database). These assert that each DAO method
// forwards the expected args and returns the model's result.
jest.mock('../../models', () => ({
  Token: {
    create: jest.fn(),
    findOne: jest.fn()
  }
}));

import { Token } from '../../models';
import TokenDAO from '../../dao/token.dao';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TokenDAO (mocked models)', () => {
  it('createToken forwards the payload to Token.create and returns the doc', async () => {
    const payload = { userId: 'u1', token: 'abc' };
    const created = { _id: 't1', ...payload };
    Token.create.mockResolvedValue(created);

    const result = await TokenDAO.createToken(payload);

    expect(Token.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('findOneToken forwards the filter to Token.findOne and returns the doc', async () => {
    const filter = { token: 'abc' };
    const doc = { _id: 't1', token: 'abc' };
    Token.findOne.mockResolvedValue(doc);

    const result = await TokenDAO.findOneToken(filter);

    expect(Token.findOne).toHaveBeenCalledWith(filter);
    expect(result).toBe(doc);
  });
});
