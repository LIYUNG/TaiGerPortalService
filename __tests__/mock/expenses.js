const { ObjectId } = require('mongoose').Types;
const { faker } = require('@faker-js/faker');

const generateExpense = ({
  studentId = new ObjectId().toHexString(),
  receiverId = new ObjectId().toHexString()
} = {}) => ({
  _id: new ObjectId().toHexString(),
  student_id: studentId,
  receiver_id: receiverId,
  expense_type: 'consultation',
  amount: faker.number.int({ min: 100, max: 5000 }),
  currency: 'TWD',
  status: 'pending',
  description: faker.lorem.sentence(),
  updatedAt: new Date()
});

module.exports = { generateExpense };
