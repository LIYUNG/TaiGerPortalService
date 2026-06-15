import { KeywordSet } from '../models';

/**
 * KeywordSetDAO — data access for the KeywordSet model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const KeywordSetDAO = {
  async getKeywordSets() {
    return KeywordSet.find({}).sort({ createdAt: -1 });
  },

  async findKeywordSet(query) {
    return KeywordSet.findOne(query);
  },

  async createKeywordSet(fields) {
    return KeywordSet.create(fields);
  },

  async updateKeywordSetById(keywordsSetId, fields) {
    return KeywordSet.findByIdAndUpdate(keywordsSetId, fields, { new: true });
  },

  async deleteKeywordSetById(keywordsSetId) {
    return KeywordSet.findByIdAndDelete(keywordsSetId);
  }
};

export = KeywordSetDAO;
