import { UpdateQuery } from 'mongoose';
import { IInternaldoc } from '@taiger-common/model';
import { Internaldoc as InternaldocModel } from '../models';
import type { IInternaldocDAO, Internaldoc } from './internaldoc.dao.types';

const toDomain = (doc: unknown): Internaldoc | null => {
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
  return out as unknown as Internaldoc;
};

class InternaldocMongoDAO implements IInternaldocDAO {
  async findAllTitleInternalCategory(): Promise<Internaldoc[]> {
    const docs = await InternaldocModel.find().select(
      'title internal category'
    );
    return docs
      .map((doc) => toDomain(doc))
      .filter((d): d is Internaldoc => d !== null);
  }

  async getById(docId: string): Promise<Internaldoc | null> {
    return toDomain(await InternaldocModel.findById(docId));
  }

  async create(fields: Partial<Internaldoc>): Promise<Internaldoc> {
    return toDomain(
      await InternaldocModel.create(fields as Partial<IInternaldoc>)
    ) as Internaldoc;
  }

  async updateById(
    docId: string,
    fields: Partial<Internaldoc>
  ): Promise<Internaldoc | null> {
    return toDomain(
      await InternaldocModel.findByIdAndUpdate(
        docId,
        fields as UpdateQuery<IInternaldoc>,
        { new: true }
      )
    );
  }

  async deleteById(docId: string): Promise<Internaldoc | null> {
    return toDomain(await InternaldocModel.findByIdAndDelete(docId));
  }
}

export = new InternaldocMongoDAO();
