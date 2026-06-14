const { internaldocsSchema } = require('@taiger-common/model');

internaldocsSchema.index({ title: 'text', text: 'text' });

module.exports = { internaldocsSchema };
