import { FilterQuery, UpdateQuery } from 'mongoose';
import { IKeywordset } from '@taiger-common/model';
import KeywordSetDAO from '../dao/keywordset.dao';
import ProgramRequirementDAO from '../dao/programRequirement.dao';

/**
 * KeywordSetService — business layer for course keyword sets. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const KeywordSetService = {
  getKeywordSets() {
    return KeywordSetDAO.getKeywordSets();
  },

  findKeywordSet(query: FilterQuery<IKeywordset>) {
    return KeywordSetDAO.findKeywordSet(query);
  },

  createKeywordSet(fields: Partial<IKeywordset>) {
    return KeywordSetDAO.createKeywordSet(fields);
  },

  updateKeywordSetById(
    keywordsSetId: string,
    fields: UpdateQuery<IKeywordset>
  ) {
    return KeywordSetDAO.updateKeywordSetById(keywordsSetId, fields);
  },

  // Delete a keyword set and remove its id from every program requirement that
  // referenced it. (The legacy controller wrapped these in a session that was
  // never attached to the writes, so the behaviour is two sequential writes.)
  async deleteKeywordSet(keywordsSetId: string) {
    await KeywordSetDAO.deleteKeywordSetById(keywordsSetId);
    await ProgramRequirementDAO.removeKeywordSetReferences(keywordsSetId);
  }
};

export = KeywordSetService;
