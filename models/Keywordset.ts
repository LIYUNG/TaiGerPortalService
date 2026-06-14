import { keywordSetSchema } from '@taiger-common/model';

keywordSetSchema.index({ categoryName: 1 });

export = { keywordSetSchema };
