import { FilterQuery } from 'mongoose';
import { IToken } from '@taiger-common/model';
import TokenDAO from '../dao/token.dao';

/**
 * TokenService — business layer for auth/activation tokens. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const TokenService = {
  createToken(payload: Partial<IToken>) {
    return TokenDAO.createToken(payload);
  },

  findOneToken(filter: FilterQuery<IToken>) {
    return TokenDAO.findOneToken(filter);
  }
};

export = TokenService;
