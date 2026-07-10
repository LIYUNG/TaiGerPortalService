import { UpdateQuery } from 'mongoose';
import { ITemplate } from '@taiger-common/model';
import { Template as TemplateModel } from '../models';
import type { ITemplateDAO, Template } from './template.dao.types';

/**
 * Map a Mongo doc (hydrated or lean) to the persistence-agnostic Template: keep
 * ALL fields (the result is sent to the frontend unchanged) but normalize `_id`
 * to a string. The only place Mongo shapes are handled.
 */
const toDomain = (doc: unknown): Template | null => {
  if (!doc) {
    return null;
  }
  const source = doc as { toObject?: () => Record<string, unknown> };
  const plain =
    typeof source.toObject === 'function'
      ? source.toObject()
      : (doc as Record<string, unknown>);
  return { ...plain, _id: String(plain._id) } as Template;
};

/**
 * TemplateMongoDAO — MongoDB strategy for download templates. Implements
 * ITemplateDAO.
 */
class TemplateMongoDAO implements ITemplateDAO {
  async getTemplates(): Promise<Template[]> {
    const docs = await TemplateModel.find({});
    return docs
      .map((doc) => toDomain(doc))
      .filter((tpl): tpl is Template => tpl !== null);
  }

  async getTemplateByCategory(categoryName: string): Promise<Template | null> {
    return toDomain(
      await TemplateModel.findOne({ category_name: categoryName })
    );
  }

  async deleteTemplateByCategory(
    categoryName: string
  ): Promise<Template | null> {
    return toDomain(
      await TemplateModel.findOneAndDelete({ category_name: categoryName })
    );
  }

  async upsertTemplate(
    categoryName: string,
    payload: Partial<Template>
  ): Promise<Template> {
    const doc = await TemplateModel.findOneAndUpdate(
      { category_name: categoryName },
      payload as UpdateQuery<ITemplate>,
      { upsert: true, new: true }
    );
    return toDomain(doc) as Template;
  }
}

export = new TemplateMongoDAO();
