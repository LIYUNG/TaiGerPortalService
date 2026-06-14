const { programRequirementSchema } = require('@taiger-common/model');

programRequirementSchema.index({ programId: 1 });

module.exports = { programRequirementSchema };
