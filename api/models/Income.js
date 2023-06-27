const {
  model,
  Schema,
  Types: { ObjectId }
} = require('mongoose');

const IncomesSchema = new Schema({
  student_id: { type: ObjectId, ref: 'User' },
  income_type: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'NTD' },
  status: { type: String, default: 'open' },
  description: { type: String, default: '' },
  updatedAt: Date
});
const Income = model('Income', IncomesSchema);
module.exports = Income;
