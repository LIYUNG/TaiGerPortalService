const { Basedocumentationslink } = require('../models');

/**
 * BasedocumentationslinkDAO — data access for the Basedocumentationslink model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const BasedocumentationslinkDAO = {
  async findByCategory(category) {
    return Basedocumentationslink.find({ category });
  },

  async upsertByCategoryKey(category, key, set) {
    return Basedocumentationslink.findOneAndUpdate(
      { category, key },
      { $set: set },
      { upsert: true }
    );
  }
};

module.exports = BasedocumentationslinkDAO;
