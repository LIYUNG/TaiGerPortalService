import { UpdateQuery } from 'mongoose';
import { IDocspage } from '@taiger-common/model';
import { Docspage as DocspageModel } from '../models';
import type { Docspage, IDocspageDAO } from './docspage.dao.types';

/**
 * Map a Mongo doc (hydrated or lean) to the persistence-agnostic Docspage: keep
 * ALL fields but normalize `_id` to a string when present. The only place Mongo
 * shapes are handled.
 */
const toDomain = (doc: unknown): Docspage | null => {
  if (!doc) {
    return null;
  }
  const source = doc as { toObject?: () => Record<string, unknown> };
  const plain =
    typeof source.toObject === 'function'
      ? source.toObject()
      : (doc as Record<string, unknown>);
  const out = { ...plain };
  if (out._id != null) {
    out._id = String(out._id);
  }
  return out as unknown as Docspage;
};

class DocspageMongoDAO implements IDocspageDAO {
  async upsertByCategory(
    category: string,
    fields: Partial<Docspage>
  ): Promise<Docspage | null> {
    return toDomain(
      await DocspageModel.findOneAndUpdate(
        { category },
        fields as UpdateQuery<IDocspage>,
        { upsert: true, new: true }
      )
    );
  }

  async getByCategory(category: string): Promise<Docspage | null> {
    return toDomain(await DocspageModel.findOne({ category }));
  }
}

export = new DocspageMongoDAO();
