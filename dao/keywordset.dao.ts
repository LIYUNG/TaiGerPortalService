import { FilterQuery, UpdateQuery } from 'mongoose';
import { IKeywordset } from '@taiger-common/model';
import { KeywordSet } from '../models';

/**
 * KeywordSetDAO — data access for the KeywordSet model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const KeywordSetDAO = {
  async getKeywordSets() {
    return KeywordSet.find({}).sort({ createdAt: -1 });
  },

  async findKeywordSet(query: FilterQuery<IKeywordset>) {
    return KeywordSet.findOne(query);
  },

  async createKeywordSet(fields: Partial<IKeywordset>) {
    return KeywordSet.create(fields);
  },

  async updateKeywordSetById(
    keywordsSetId: string,
    fields: UpdateQuery<IKeywordset>
  ) {
    return KeywordSet.findByIdAndUpdate(keywordsSetId, fields, { new: true });
  },

  async deleteKeywordSetById(keywordsSetId: string) {
    return KeywordSet.findByIdAndDelete(keywordsSetId);
  }
};

export = KeywordSetDAO;
