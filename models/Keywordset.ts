import { keywordSetSchema } from '@taiger-common/model';

keywordSetSchema.index({ categoryName: 1 });

module.exports = { keywordSetSchema };
