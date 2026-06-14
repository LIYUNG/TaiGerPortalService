const { communicationsSchema } = require('@taiger-common/model');

communicationsSchema.index({ student_id: 1 });
module.exports = {
  communicationsSchema
};
