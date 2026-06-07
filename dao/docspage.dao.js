const { Docspage } = require('../models');

/**
 * DocspageDAO — data access for the Docspage model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const DocspageDAO = {
  async upsertByCategory(category, fields) {
    return Docspage.findOneAndUpdate({ category }, fields, {
      upsert: true,
      new: true
    });
  },

  async getByCategory(category) {
    return Docspage.findOne({ category });
  }
};

module.exports = DocspageDAO;
