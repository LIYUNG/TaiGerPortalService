const {
  model,
  Schema,
  Types: { ObjectId }
} = require('mongoose');

const expensesSchema = new Schema({
  student_id: { type: ObjectId, ref: 'User' },
  receiver_id: { type: ObjectId, ref: 'User' },
  expense_type: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'NTD' },
  status: { type: String, default: 'open' },
  description: { type: String, default: '' },
  updatedAt: Date
});
const Expense = model('Expense', expensesSchema);
module.exports = { Expense, expensesSchema };
