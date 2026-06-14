const { documentationsSchema } = require('@taiger-common/model');

documentationsSchema.index({ title: 'text', text: 'text' });

module.exports = { documentationsSchema };
