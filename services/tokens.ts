import TokenDAO from '../dao/token.dao';

/**
 * TokenService — business layer for auth/activation tokens. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const TokenService = {
  createToken(payload) {
    return TokenDAO.createToken(payload);
  },

  findOneToken(filter) {
    return TokenDAO.findOneToken(filter);
  }
};

export = TokenService;
