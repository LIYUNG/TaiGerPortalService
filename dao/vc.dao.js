const { VC } = require('../models');

/**
 * VCDAO — data access for the VC (version control) model (central
 * default-connection model). Plain params, no req.
 */
const VCDAO = {
  async getVC(filter) {
    return VC.findOne(filter).lean();
  }
};

module.exports = VCDAO;
