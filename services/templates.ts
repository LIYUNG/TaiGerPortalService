import { UpdateQuery } from 'mongoose';
import { ITemplate } from '@taiger-common/model';
import TemplateDAO from '../dao/template.dao';

/**
 * TemplateService — business layer for download templates. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const TemplateService = {
  getTemplates() {
    return TemplateDAO.getTemplates();
  },

  getTemplateByCategory(categoryName: string) {
    return TemplateDAO.getTemplateByCategory(categoryName);
  },

  deleteTemplateByCategory(categoryName: string) {
    return TemplateDAO.deleteTemplateByCategory(categoryName);
  },

  upsertTemplate(categoryName: string, payload: UpdateQuery<ITemplate>) {
    return TemplateDAO.upsertTemplate(categoryName, payload);
  }
};

export = TemplateService;
