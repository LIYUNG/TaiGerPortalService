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

  findKeywordSet(query) {
    return KeywordSetDAO.findKeywordSet(query);
  },

  createKeywordSet(fields) {
    return KeywordSetDAO.createKeywordSet(fields);
  },

  updateKeywordSetById(keywordsSetId, fields) {
    return KeywordSetDAO.updateKeywordSetById(keywordsSetId, fields);
  },

  // Delete a keyword set and remove its id from every program requirement that
  // referenced it. (The legacy controller wrapped these in a session that was
  // never attached to the writes, so the behaviour is two sequential writes.)
  async deleteKeywordSet(keywordsSetId) {
    await KeywordSetDAO.deleteKeywordSetById(keywordsSetId);
    await ProgramRequirementDAO.removeKeywordSetReferences(keywordsSetId);
  }
};

export = KeywordSetService;
