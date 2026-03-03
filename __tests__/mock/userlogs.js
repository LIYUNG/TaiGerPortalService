const { ObjectId } = require('mongoose').Types;
const { faker } = require('@faker-js/faker');

const generateUserlog = (userId = new ObjectId().toHexString()) => ({
  _id: new ObjectId().toHexString(),
  user_id: userId,
  apiCallCount: faker.number.int({ min: 1, max: 100 }),
  apiPath: `/api/${faker.lorem.word()}`,
  operation: 'GET',
  date: new Date().toISOString().split('T')[0],
  createdAt: new Date()
});

module.exports = { generateUserlog };
