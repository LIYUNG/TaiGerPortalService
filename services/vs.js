const VCDAO = require('../dao/vc.dao');

/**
 * VCService — business layer; delegates data access to the DAO.
 */
const VCService = {
  getVC(filter) {
    return VCDAO.getVC(filter);
  }
};

module.exports = VCService;
