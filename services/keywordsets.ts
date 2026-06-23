import KeywordSetDAO from '../dao/keywordset.dao';
import ProgramRequirementDAO from '../dao/programRequirement.dao';
import type {
  IKeywordSetDAO,
  KeywordSet,
  KeywordSetMatchInput
} from '../dao/keywordset.dao.types';

/**
 * KeywordSetService — business layer for course keyword sets. Depends on the
 * IKeywordSetDAO strategy contract (constructor injection). `deleteKeywordSet`
 * also composes ProgramRequirementDAO for reference cleanup; that secondary DAO
 * is imported directly for now and will be constructor-injected once its own
 * domain is migrated to the same pattern.
 */
export class KeywordSetService {
  constructor(private readonly dao: IKeywordSetDAO) {}

  getKeywordSets() {
    return this.dao.getKeywordSets();
  }

  findKeywordSet(match: KeywordSetMatchInput) {
    return this.dao.findKeywordSet(match);
  }

  createKeywordSet(fields: Partial<KeywordSet>) {
    return this.dao.createKeywordSet(fields);
  }

  updateKeywordSetById(keywordsSetId: string, fields: Partial<KeywordSet>) {
    return this.dao.updateKeywordSetById(keywordsSetId, fields);
  }

  // Delete a keyword set and remove its id from every program requirement that
  // referenced it. (The legacy controller wrapped these in a session that was
  // never attached to the writes, so the behaviour is two sequential writes.)
  async deleteKeywordSet(keywordsSetId: string) {
    await this.dao.deleteKeywordSetById(keywordsSetId);
    await ProgramRequirementDAO.removeKeywordSetReferences(keywordsSetId);
  }
}

// Production instance, wired to the MongoDB strategy.
const keywordSetService = new KeywordSetService(KeywordSetDAO);

export default keywordSetService;
