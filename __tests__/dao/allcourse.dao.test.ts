// AllcourseDAO unit tests — the DAO is a thin query-building layer over the
// Allcourse model, so we mock the model entirely (NO database, in-memory or
// otherwise). These assert that each DAO method forwards the right args to the
// model and returns the model's result. Real query behaviour is covered by the
// integration suite (__tests__/integration).
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    create: jest.fn()
  });
  return {
    Allcourse: model()
  };
});

import { Allcourse } from '../../models';
import AllcourseDAO from '../../dao/allcourse.dao';

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (populate) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

// A chain that resolves directly via populate (no terminal `.lean()`); the
// populate-returned thenable carries the value.
const populateChain = (value) => {
  const chain = {
    populate: jest.fn(() => Promise.resolve(value))
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AllcourseDAO (mocked models)', () => {
  it('getAllcourses finds all, populates updatedBy and returns the lean docs', async () => {
    const docs = [{ _id: 'c1' }];
    Allcourse.find.mockReturnValue(leanChain(docs));

    const result = await AllcourseDAO.getAllcourses();

    expect(Allcourse.find).toHaveBeenCalledWith();
    expect(result).toBe(docs);
  });

  it('getAllcourseById queries by id and populates updatedBy', async () => {
    const doc = { _id: 'c1' };
    Allcourse.findById.mockReturnValue(populateChain(doc));

    const found = await AllcourseDAO.getAllcourseById('c1');

    expect(Allcourse.findById).toHaveBeenCalledWith('c1');
    expect(found).toBe(doc);
  });

  it('deleteAllcourseById deletes by id and returns the model result', async () => {
    const deleted = { _id: 'c1' };
    Allcourse.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await AllcourseDAO.deleteAllcourseById('c1');

    expect(Allcourse.findByIdAndDelete).toHaveBeenCalledWith('c1');
    expect(result).toBe(deleted);
  });

  it('updateAllcourseById updates with new+runValidators and populates updatedBy', async () => {
    const updated = { _id: 'c1', all_course_english: 'Updated Name' };
    Allcourse.findByIdAndUpdate.mockReturnValue(populateChain(updated));

    const payload = { all_course_english: 'Updated Name' };
    const result = await AllcourseDAO.updateAllcourseById('c1', payload);

    expect(Allcourse.findByIdAndUpdate).toHaveBeenCalledWith('c1', payload, {
      new: true,
      runValidators: true
    });
    expect(result).toBe(updated);
  });

  it('createAllcourse forwards the payload to create and returns the doc', async () => {
    const created = { _id: 'c1' };
    Allcourse.create.mockResolvedValue(created);

    const payload = { all_course_english: 'New' };
    const result = await AllcourseDAO.createAllcourse(payload);

    expect(Allcourse.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });
});
