const BasedocumentationslinkDAO = require('../dao/basedocumentationslink.dao');

/**
 * BasedocumentationslinkService — business layer for the base-documents / survey
 * helper links. Delegates data access to the DAO (controller -> service -> dao).
 */
const BasedocumentationslinkService = {
  findByCategory(category) {
    return BasedocumentationslinkDAO.findByCategory(category);
  },

  upsertByCategoryKey(category, key, set) {
    return BasedocumentationslinkDAO.upsertByCategoryKey(category, key, set);
  }
};

module.exports = BasedocumentationslinkService;
