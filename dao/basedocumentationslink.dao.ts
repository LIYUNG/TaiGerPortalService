import { UpdateQuery } from 'mongoose';
import { IBasedocumentationslink } from '@taiger-common/model';
import { Basedocumentationslink as BasedocumentationslinkModel } from '../models';
import type {
  Basedocumentationslink,
  IBasedocumentationslinkDAO
} from './basedocumentationslink.dao.types';

/**
 * Map a Mongo doc (hydrated or lean) to the persistence-agnostic entity: keep
 * ALL fields but normalize `_id` to a string. The only place Mongo shapes are
 * handled.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDomain = (doc: any): Basedocumentationslink | null => {
  if (!doc) {
    return null;
  }
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return { ...plain, _id: String(plain._id) } as Basedocumentationslink;
};

/**
 * BasedocumentationslinkMongoDAO — MongoDB strategy for the base-documents /
 * survey helper links. Implements IBasedocumentationslinkDAO.
 */
class BasedocumentationslinkMongoDAO implements IBasedocumentationslinkDAO {
  async findByCategory(category: string): Promise<Basedocumentationslink[]> {
    const docs = await BasedocumentationslinkModel.find({ category });
    return docs
      .map((doc) => toDomain(doc))
      .filter((link): link is Basedocumentationslink => link !== null);
  }

  async upsertByCategoryKey(
    category: string,
    key: string,
    set: Partial<Basedocumentationslink>
  ): Promise<Basedocumentationslink | null> {
    const doc = await BasedocumentationslinkModel.findOneAndUpdate(
      { category, key },
      { $set: set } as UpdateQuery<IBasedocumentationslink>,
      { upsert: true }
    );
    return toDomain(doc);
  }
}

export = new BasedocumentationslinkMongoDAO();
