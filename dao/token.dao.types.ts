/**
 * Persistence-agnostic auth/activation token entity — the shape returned by ANY
 * Token DAO implementation. String `id` (not `_id`), no ObjectId, so nothing
 * above the DAO couples to the storage engine.
 */
export interface Token {
  id: string;
  userId: string;
  value: string;
  createdAt?: Date;
}

/** Input for issuing a token (domain-level; no Mongo `Partial<IToken>`). */
export interface CreateTokenInput {
  userId: string;
  value: string;
}

/**
 * Strategy contract for token data access. Domain-level params only (a hashed
 * `value`, a string `id`) — NOT a Mongo `FilterQuery` — so a PostgreSQL DAO can
 * satisfy the same interface.
 */
export interface ITokenDAO {
  createToken(input: CreateTokenInput): Promise<Token>;
  findTokenByValue(value: string): Promise<Token | null>;
  deleteTokenById(id: string): Promise<void>;
}
