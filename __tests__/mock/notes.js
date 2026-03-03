const { ObjectId } = require('mongoose').Types;
const { faker } = require('@faker-js/faker');

const generateNote = (studentId = new ObjectId().toHexString()) => ({
  _id: new ObjectId().toHexString(),
  student_id: studentId,
  content: faker.lorem.paragraphs(2),
  updatedAt: new Date()
});

module.exports = { generateNote };
