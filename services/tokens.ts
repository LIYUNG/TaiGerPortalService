import TokenDAO from '../dao/token.dao';
import type { CreateTokenInput, ITokenDAO } from '../dao/token.dao.types';

/**
 * TokenService — business layer for auth/activation tokens. Depends only on the
 * ITokenDAO strategy contract (constructor injection), so the storage engine can
 * be swapped by constructing the service with a different DAO.
 */
export class TokenService {
  constructor(private readonly dao: ITokenDAO) {}

  createToken(input: CreateTokenInput) {
    return this.dao.createToken(input);
  }

  findTokenByValue(value: string) {
    return this.dao.findTokenByValue(value);
  }

  deleteTokenById(id: string) {
    return this.dao.deleteTokenById(id);
  }
}

// Production instance, wired to the MongoDB strategy.
const tokenService = new TokenService(TokenDAO);

export default tokenService;
