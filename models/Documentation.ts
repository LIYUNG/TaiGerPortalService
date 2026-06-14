import { documentationsSchema } from '@taiger-common/model';

documentationsSchema.index({ title: 'text', text: 'text' });

module.exports = { documentationsSchema };
