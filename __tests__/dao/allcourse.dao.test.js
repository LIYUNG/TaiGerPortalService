// DAO-level integration test for AllcourseDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Allcourse, User } = require('../../models');
const AllcourseDAO = require('../../dao/allcourse.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin } = require('../mock/user');
const { generateAllCourse } = require('../fixtures/faker');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Allcourse.deleteMany({});
  await User.deleteMany({});
  await User.insertMany(users);
});

describe('AllcourseDAO (in-memory)', () => {
  it('createAllcourse inserts and getAllcourses returns it', async () => {
    await AllcourseDAO.createAllcourse(generateAllCourse());

    const courses = await AllcourseDAO.getAllcourses();

    expect(courses).toHaveLength(1);
  });

  it('getAllcourseById returns the matching course', async () => {
    const created = await AllcourseDAO.createAllcourse(generateAllCourse());

    const found = await AllcourseDAO.getAllcourseById(created._id);

    expect(found._id.toString()).toBe(created._id.toString());
  });

  it('updateAllcourseById applies the update and populates updatedBy', async () => {
    const created = await AllcourseDAO.createAllcourse(generateAllCourse());

    const updated = await AllcourseDAO.updateAllcourseById(created._id, {
      all_course_english: 'Updated Name',
      updatedBy: admin._id.toString()
    });

    expect(updated.all_course_english).toBe('Updated Name');
    expect(updated.updatedBy.firstname).toBe(admin.firstname);
  });

  it('deleteAllcourseById removes the record', async () => {
    const created = await AllcourseDAO.createAllcourse(generateAllCourse());

    await AllcourseDAO.deleteAllcourseById(created._id);

    expect(await Allcourse.countDocuments({})).toBe(0);
  });

  it('getAllcourseById returns null for a missing id', async () => {
    const { ObjectId } = require('mongoose').Types;
    const found = await AllcourseDAO.getAllcourseById(
      new ObjectId().toHexString()
    );
    expect(found).toBeNull();
  });
});
