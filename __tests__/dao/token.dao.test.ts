// TokenDAO unit tests — the DAO is a thin query + mapping layer over the Token
// Mongoose model, so we mock the model entirely (NO database). Returns are the
// persistence-agnostic Token (`_id` -> `id`), so assertions check the MAPPED
// shape.
jest.mock('../../models', () => ({
  Token: {
    create: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn()
  }
}));

import { Token } from '../../models';
import TokenDAO from '../../dao/token.dao';

// A query chain whose terminal `.lean()` resolves to `value`.
const leanChain = (value) => ({
  lean: jest.fn().mockResolvedValue(value)
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TokenDAO (mocked models)', () => {
  it('createToken forwards the input to Token.create and returns the mapped token', async () => {
    const input = { userId: 'u1', value: 'abc' };
    Token.create.mockResolvedValue({ _id: 't1', ...input });

    const result = await TokenDAO.createToken(input);

    expect(Token.create).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({ id: 't1', userId: 'u1', value: 'abc' });
  });

  it('findTokenByValue queries by value (lean) and maps the doc', async () => {
    Token.findOne.mockReturnValue(
      leanChain({ _id: 't1', userId: 'u1', value: 'abc' })
    );

    const result = await TokenDAO.findTokenByValue('abc');

    expect(Token.findOne).toHaveBeenCalledWith({ value: 'abc' });
    expect(result).toMatchObject({ id: 't1', userId: 'u1', value: 'abc' });
  });

  it('findTokenByValue returns null when no token matches', async () => {
    Token.findOne.mockReturnValue(leanChain(null));

    expect(await TokenDAO.findTokenByValue('missing')).toBeNull();
  });

  it('deleteTokenById deletes by _id and returns void', async () => {
    Token.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await TokenDAO.deleteTokenById('t1');

    expect(Token.deleteOne).toHaveBeenCalledWith({ _id: 't1' });
    expect(result).toBeUndefined();
  });
});
