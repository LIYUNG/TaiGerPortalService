const { Token } = require('../models');

/**
 * TokenDAO — data access for the Token model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const TokenDAO = {
  async createToken(payload) {
    return Token.create(payload);
  },

  // Live (non-lean) document so callers can call token.deleteOne().
  async findOneToken(filter) {
    return Token.findOne(filter);
  }
};

module.exports = TokenDAO;
