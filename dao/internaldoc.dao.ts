import { Internaldoc } from '../models';

/**
 * InternaldocDAO — data access for the Internaldoc model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const InternaldocDAO = {
  async findAllTitleInternalCategory() {
    return Internaldoc.find().select('title internal category');
  },

  async getById(docId) {
    return Internaldoc.findById(docId);
  },

  async create(fields) {
    return Internaldoc.create(fields);
  },

  async updateById(docId, fields) {
    return Internaldoc.findByIdAndUpdate(docId, fields, { new: true });
  },

  async deleteById(docId) {
    return Internaldoc.findByIdAndDelete(docId);
  }
};

export = InternaldocDAO;
