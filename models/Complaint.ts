const { complaintSchema } = require('@taiger-common/model');

complaintSchema.index({ requester_id: 1 });

module.exports = { complaintSchema };
