const { interviewsSchema } = require('@taiger-common/model');

interviewsSchema.index(
  { student_id: 1, program_id: 1, thread_id: 1 },
  { unique: true }
);

module.exports = {
  interviewsSchema
};
