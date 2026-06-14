const { auditSchema } = require('@taiger-common/model');

auditSchema.index({ performedBy: 1, targetUserId: 1, targetDocumentId: 1 });
module.exports = {
  auditSchema
};
