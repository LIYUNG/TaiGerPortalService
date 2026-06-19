import type { ITemplate } from '@taiger-common/model';

/**
 * Persistence-agnostic download-template entity. `_id` is kept (as a STRING) so
 * API responses are byte-identical; all other fields come from ITemplate.
 */
export interface Template extends Omit<ITemplate, '_id'> {
  _id: string;
}

/** Strategy contract for template data access (domain-level params, no Mongo). */
export interface ITemplateDAO {
  getTemplates(): Promise<Template[]>;
  getTemplateByCategory(categoryName: string): Promise<Template | null>;
  deleteTemplateByCategory(categoryName: string): Promise<Template | null>;
  upsertTemplate(
    categoryName: string,
    payload: Partial<Template>
  ): Promise<Template>;
}
