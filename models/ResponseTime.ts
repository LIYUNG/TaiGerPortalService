const { ResponseTimeSchema } = require('@taiger-common/model');

ResponseTimeSchema.index(
  { student_id: 1, thread_id: 1, interval_type: 1 },
  { unique: true }
);

module.exports = {
  ResponseTimeSchema
};
