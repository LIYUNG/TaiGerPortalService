import TemplateDAO from '../dao/template.dao';
import type { ITemplateDAO, Template } from '../dao/template.dao.types';

/**
 * TemplateService — business layer for download templates. Depends only on the
 * ITemplateDAO strategy contract (constructor injection), so the storage engine
 * can be swapped by constructing the service with a different DAO.
 */
export class TemplateService {
  constructor(private readonly dao: ITemplateDAO) {}

  getTemplates() {
    return this.dao.getTemplates();
  }

  getTemplateByCategory(categoryName: string) {
    return this.dao.getTemplateByCategory(categoryName);
  }

  deleteTemplateByCategory(categoryName: string) {
    return this.dao.deleteTemplateByCategory(categoryName);
  }

  upsertTemplate(categoryName: string, payload: Partial<Template>) {
    return this.dao.upsertTemplate(categoryName, payload);
  }
}

// Production instance, wired to the MongoDB strategy.
const templateService = new TemplateService(TemplateDAO);

export default templateService;
