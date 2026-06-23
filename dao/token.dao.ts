import { Token as TokenModel } from '../models';
import type { CreateTokenInput, ITokenDAO, Token } from './token.dao.types';

/**
 * Map a Mongo doc to the persistence-agnostic Token (`_id` -> `id`). The only
 * place Mongo shapes are allowed; everything above sees a plain Token.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDomain = (doc: any): Token | null => {
  if (!doc) {
    return null;
  }
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    value: doc.value,
    createdAt: doc.createdAt as Date | undefined
  };
};

/**
 * TokenMongoDAO — MongoDB strategy for auth/activation tokens (default-connection
 * model from models/index.js). Implements ITokenDAO; no per-instance state, so
 * it's exported as a singleton instance.
 */
class TokenMongoDAO implements ITokenDAO {
  async createToken(input: CreateTokenInput): Promise<Token> {
    const doc = await TokenModel.create(input);
    return toDomain(doc) as Token;
  }

  async findTokenByValue(value: string): Promise<Token | null> {
    const doc = await TokenModel.findOne({ value }).lean();
    return toDomain(doc);
  }

  async deleteTokenById(id: string): Promise<void> {
    await TokenModel.deleteOne({ _id: id });
  }
}

export = new TokenMongoDAO();
