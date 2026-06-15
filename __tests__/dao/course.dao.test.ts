// CourseDAO unit tests — the DAO is a thin query-building layer over the Course
// Mongoose model, so we mock the model entirely (NO database). These assert
// that each DAO method builds the expected query/chain and forwards the
// model's result. Real query behaviour is covered by the integration suite.
jest.mock('../../models', () => {
  const model = () => ({
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    create: jest.fn()
  });
  return {
    Course: model()
  };
});

import { Course } from '../../models';
import CourseDAO from '../../dao/course.dao';

// A query chain that is both chainable (populate/lean return the same chain)
// and thenable, so `await chain` (when a method ends in .populate() without a
// trailing .lean()) resolves to `value` too. Terminal `.lean()` resolves to
// value as well.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CourseDAO (mocked models)', () => {
  it('getCourse finds one, populates the student and returns the lean doc', async () => {
    const doc = { _id: 'c1' };
    Course.findOne.mockReturnValue(queryChain(doc));

    const res = await CourseDAO.getCourse({ student_id: 's1' });

    expect(Course.findOne).toHaveBeenCalledWith({ student_id: 's1' });
    const chain = Course.findOne.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'student_id',
      'firstname lastname firstname_chinese lastname_chinese email role academic_background archiv pictureUrl application_preference'
    );
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(doc);
  });

  it('updateCourse updates with { new: true } and returns the lean doc', async () => {
    const updated = { _id: 'c1', table_data_string_locked: true };
    Course.findOneAndUpdate.mockReturnValue(queryChain(updated));

    const res = await CourseDAO.updateCourse(
      { student_id: 's1' },
      { table_data_string_locked: true }
    );

    expect(Course.findOneAndUpdate).toHaveBeenCalledWith(
      { student_id: 's1' },
      { table_data_string_locked: true },
      { new: true }
    );
    const chain = Course.findOneAndUpdate.mock.results[0].value;
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(updated);
  });

  it('upsertCourseByStudentId upserts (new:false), populates and returns the pre-update doc', async () => {
    const prev = { _id: 'c1' };
    Course.findOneAndUpdate.mockReturnValue(queryChain(prev));

    const res = await CourseDAO.upsertCourseByStudentId('s1', { a: 1 });

    expect(Course.findOneAndUpdate).toHaveBeenCalledWith(
      { student_id: 's1' },
      { a: 1 },
      { upsert: true, new: false }
    );
    const chain = Course.findOneAndUpdate.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'student_id',
      'firstname lastname pictureUrl'
    );
    expect(res).toBe(prev);
  });

  it('deleteCourse deletes one and returns the lean doc', async () => {
    const deleted = { _id: 'c1' };
    Course.findOneAndDelete.mockReturnValue(queryChain(deleted));

    const res = await CourseDAO.deleteCourse({ student_id: 's1' });

    expect(Course.findOneAndDelete).toHaveBeenCalledWith({ student_id: 's1' });
    const chain = Course.findOneAndDelete.mock.results[0].value;
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(deleted);
  });

  it('createCourse delegates to Course.create and returns the doc', async () => {
    const data = { student_id: 's1' };
    const created = { _id: 'c1', ...data };
    Course.create.mockResolvedValue(created);

    const res = await CourseDAO.createCourse(data);

    expect(Course.create).toHaveBeenCalledWith(data);
    expect(res).toBe(created);
  });

  it('getCourseById finds by id and returns the lean doc', async () => {
    const doc = { _id: 'c1' };
    Course.findById.mockReturnValue(queryChain(doc));

    const res = await CourseDAO.getCourseById('c1');

    expect(Course.findById).toHaveBeenCalledWith('c1');
    const chain = Course.findById.mock.results[0].value;
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(doc);
  });
});
