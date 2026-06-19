import { IKeywordset } from '@taiger-common/model';
import { KeywordSet as KeywordSetModel } from '../models';
import type {
  IKeywordSetDAO,
  KeywordSet,
  KeywordSetMatchInput
} from './keywordset.dao.types';

/**
 * Map a Mongo doc (lean or hydrated) to the persistence-agnostic KeywordSet:
 * keep ALL fields (the result is sent to the frontend unchanged) but normalize
 * `_id` to a string. The only place Mongo shapes are handled.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDomain = (doc: any): KeywordSet | null => {
  if (!doc) {
    return null;
  }
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return { ...plain, _id: String(plain._id) } as KeywordSet;
};

/**
 * KeywordSetMongoDAO — MongoDB strategy for course keyword sets. Implements
 * IKeywordSetDAO; the dedup query is built HERE (not in the controller), keeping
 * Mongo query operators out of the contract.
 */
class KeywordSetMongoDAO implements IKeywordSetDAO {
  async getKeywordSets(): Promise<KeywordSet[]> {
    const docs = await KeywordSetModel.find({}).sort({ createdAt: -1 }).lean();
    return docs
      .map((doc) => toDomain(doc))
      .filter((set): set is KeywordSet => set !== null);
  }

  async findKeywordSet(
    match: KeywordSetMatchInput
  ): Promise<KeywordSet | null> {
    // A set is a duplicate if it shares keywords AND antiKeywords in EITHER
    // language (zh or en).
    const doc = await KeywordSetModel.findOne({
      $or: [
        {
          $and: [
            { 'keywords.zh': { $in: match.keywords.zh } },
            { 'antiKeywords.zh': { $in: match.antiKeywords.zh } }
          ]
        },
        {
          $and: [
            { 'keywords.en': { $in: match.keywords.en } },
            { 'antiKeywords.en': { $in: match.antiKeywords.en } }
          ]
        }
      ]
    }).lean();
    return toDomain(doc);
  }

  async createKeywordSet(fields: Partial<KeywordSet>): Promise<KeywordSet> {
    const doc = await KeywordSetModel.create(fields as Partial<IKeywordset>);
    return toDomain(doc) as KeywordSet;
  }

  async updateKeywordSetById(
    id: string,
    fields: Partial<KeywordSet>
  ): Promise<KeywordSet | null> {
    const doc = await KeywordSetModel.findByIdAndUpdate(id, fields, {
      new: true
    }).lean();
    return toDomain(doc);
  }

  async deleteKeywordSetById(id: string): Promise<void> {
    await KeywordSetModel.findByIdAndDelete(id);
  }
}

export = new KeywordSetMongoDAO();
