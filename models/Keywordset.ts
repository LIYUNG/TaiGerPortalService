const { keywordSetSchema } = require('@taiger-common/model');

keywordSetSchema.index({ categoryName: 1 });

module.exports = { keywordSetSchema };
