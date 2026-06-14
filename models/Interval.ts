const { intervalSchema } = require('@taiger-common/model');

intervalSchema.index(
  {
    student_id: 1,
    thread_id: 1,
    interval_type: 1,
    message_1_id: 1,
    message_2_id: 1
  },
  { unique: true }
);

module.exports = {
  intervalSchema
};
