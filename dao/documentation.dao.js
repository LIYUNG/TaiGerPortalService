const { Documentation } = require('../models');

/**
 * DocumentationDAO — data access for the Documentation model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const DocumentationDAO = {
  async findByCategory(category) {
    // Exclude the (large) text field from the list payload.
    return Documentation.find({ category }, { text: 0 });
  },

  async findAllTitleCategory() {
    return Documentation.find().select('title category');
  },

  async getById(docId) {
    return Documentation.findById(docId);
  },

  async create(fields) {
    return Documentation.create(fields);
  },

  async updateById(docId, fields) {
    return Documentation.findByIdAndUpdate(docId, fields, { new: true });
  },

  async deleteById(docId) {
    return Documentation.findByIdAndDelete(docId);
  }
};

module.exports = DocumentationDAO;
