import { UpdateQuery } from 'mongoose';
import { IDocumentation } from '@taiger-common/model';
import { Documentation as DocumentationModel } from '../models';
import type {
  Documentation,
  IDocumentationDAO
} from './documentation.dao.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDomain = (doc: any): Documentation | null => {
  if (!doc) {
    return null;
  }
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const out = { ...plain };
  if (out._id != null) {
    out._id = String(out._id);
  }
  return out as Documentation;
};

class DocumentationMongoDAO implements IDocumentationDAO {
  async findAllTitleCategory(): Promise<Documentation[]> {
    const docs = await DocumentationModel.find().select('title category');
    return docs
      .map((doc) => toDomain(doc))
      .filter((d): d is Documentation => d !== null);
  }

  async getById(docId: string): Promise<Documentation | null> {
    return toDomain(await DocumentationModel.findById(docId));
  }

  async create(fields: Partial<Documentation>): Promise<Documentation> {
    return toDomain(
      await DocumentationModel.create(fields as Partial<IDocumentation>)
    ) as Documentation;
  }

  async updateById(
    docId: string,
    fields: Partial<Documentation>
  ): Promise<Documentation | null> {
    return toDomain(
      await DocumentationModel.findByIdAndUpdate(
        docId,
        fields as UpdateQuery<IDocumentation>,
        { new: true }
      )
    );
  }

  async deleteById(docId: string): Promise<Documentation | null> {
    return toDomain(await DocumentationModel.findByIdAndDelete(docId));
  }
}

export = new DocumentationMongoDAO();
