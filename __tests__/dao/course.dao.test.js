// DAO-level integration test for CourseDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Course, User } = require('../../models');
const CourseDAO = require('../../dao/course.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, student } = require('../mock/user');
const { generateCourse } = require('../fixtures/faker');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Course.deleteMany({});
  await User.deleteMany({});
  await User.insertMany(users);
});

describe('CourseDAO (in-memory)', () => {
  it('createCourse inserts and getCourse returns it with the student populated', async () => {
    await CourseDAO.createCourse(generateCourse(student._id));

    const course = await CourseDAO.getCourse({ student_id: student._id });

    expect(course).toBeTruthy();
    expect(course.student_id._id.toString()).toBe(student._id.toString());
    expect(course.student_id.firstname).toBe(student.firstname);
  });

  it('getCourse returns null when no record exists', async () => {
    const course = await CourseDAO.getCourse({ student_id: student._id });
    expect(course).toBeNull();
  });

  it('updateCourse applies the update and returns the new document', async () => {
    await CourseDAO.createCourse(generateCourse(student._id));

    const updated = await CourseDAO.updateCourse(
      { student_id: student._id },
      { table_data_string_locked: true }
    );

    expect(updated.table_data_string_locked).toBe(true);
  });

  it('getCourseById returns the matching course', async () => {
    const created = await CourseDAO.createCourse(generateCourse(student._id));

    const found = await CourseDAO.getCourseById(created._id);

    expect(found._id.toString()).toBe(created._id.toString());
  });

  it('deleteCourse removes the record', async () => {
    await CourseDAO.createCourse(generateCourse(student._id));

    await CourseDAO.deleteCourse({ student_id: student._id });

    expect(await Course.countDocuments({})).toBe(0);
  });
});
