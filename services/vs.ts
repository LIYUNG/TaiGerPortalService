import VCDAO from '../dao/vc.dao';

/**
 * VCService — business layer; delegates data access to the DAO.
 */
const VCService = {
  getVC(filter) {
    return VCDAO.getVC(filter);
  },

  pushChange(filter, change) {
    return VCDAO.pushChange(filter, change);
  }
};

export = VCService;
