const TemplateDAO = require('../dao/template.dao');

/**
 * TemplateService — business layer for download templates. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const TemplateService = {
  getTemplates() {
    return TemplateDAO.getTemplates();
  },

  getTemplateByCategory(categoryName) {
    return TemplateDAO.getTemplateByCategory(categoryName);
  },

  deleteTemplateByCategory(categoryName) {
    return TemplateDAO.deleteTemplateByCategory(categoryName);
  },

  upsertTemplate(categoryName, payload) {
    return TemplateDAO.upsertTemplate(categoryName, payload);
  }
};

module.exports = TemplateService;
