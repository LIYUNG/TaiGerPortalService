import { Template } from '../models';

/**
 * TemplateDAO — data access for the Template model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const TemplateDAO = {
  async getTemplates() {
    return Template.find({});
  },

  async getTemplateByCategory(categoryName) {
    return Template.findOne({ category_name: categoryName });
  },

  async deleteTemplateByCategory(categoryName) {
    return Template.findOneAndDelete({ category_name: categoryName });
  },

  async upsertTemplate(categoryName, payload) {
    return Template.findOneAndUpdate({ category_name: categoryName }, payload, {
      upsert: true,
      new: true
    });
  }
};

module.exports = TemplateDAO;
