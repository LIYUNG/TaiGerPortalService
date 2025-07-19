const { documentThreadsSchema } = require('@taiger-common/model');
const { model } = require('mongoose');

// documentThreadsSchema.index(
//   { student_id: 1, program_id: 1, file_type: 1 },
//   { unique: true }
// );
const Documentthread = model('Documentthread', documentThreadsSchema);

module.exports = {
  Documentthread,
  documentThreadsSchema
};
