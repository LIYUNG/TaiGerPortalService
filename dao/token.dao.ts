import { FilterQuery } from 'mongoose';
import { IToken } from '@taiger-common/model';
import { Token } from '../models';

/**
 * TokenDAO — data access for the Token model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const TokenDAO = {
  async createToken(payload: Partial<IToken>) {
    return Token.create(payload);
  },

  // Live (non-lean) document so callers can call token.deleteOne().
  async findOneToken(filter: FilterQuery<IToken>) {
    return Token.findOne(filter);
  }
};

export = TokenDAO;
