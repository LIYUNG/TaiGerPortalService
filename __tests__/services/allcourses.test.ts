// AllcourseService methods are thin pass-throughs to AllcourseDAO. This is a
// UNIT test: the DAO is mocked so no database (in-memory or otherwise) is
// touched. Each test asserts the service delegates to the right DAO method with
// the exact args and returns the DAO's (mocked) value.
jest.mock('../../dao/allcourse.dao');

const AllcourseDAO = require('../../dao/allcourse.dao');
const AllcourseService = require('../../services/allcourses');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AllcourseService.getAllcourses (mocked DAO)', () => {
  it('delegates to DAO.getAllcourses and returns its result', () => {
    const daoResult = [{ _id: 'c1' }, { _id: 'c2' }];
    AllcourseDAO.getAllcourses.mockReturnValue(daoResult);

    const result = AllcourseService.getAllcourses();

    expect(AllcourseDAO.getAllcourses).toHaveBeenCalledTimes(1);
    expect(AllcourseDAO.getAllcourses).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('AllcourseService.getAllcourseById (mocked DAO)', () => {
  it('delegates to DAO.getAllcourseById with courseId and returns its result', () => {
    const daoResult = { _id: 'c1' };
    AllcourseDAO.getAllcourseById.mockReturnValue(daoResult);

    const result = AllcourseService.getAllcourseById('c1');

    expect(AllcourseDAO.getAllcourseById).toHaveBeenCalledTimes(1);
    expect(AllcourseDAO.getAllcourseById).toHaveBeenCalledWith('c1');
    expect(result).toBe(daoResult);
  });
});

describe('AllcourseService.deleteAllcourseById (mocked DAO)', () => {
  it('delegates to DAO.deleteAllcourseById with courseId and returns its result', () => {
    const daoResult = { deletedCount: 1 };
    AllcourseDAO.deleteAllcourseById.mockReturnValue(daoResult);

    const result = AllcourseService.deleteAllcourseById('c1');

    expect(AllcourseDAO.deleteAllcourseById).toHaveBeenCalledTimes(1);
    expect(AllcourseDAO.deleteAllcourseById).toHaveBeenCalledWith('c1');
    expect(result).toBe(daoResult);
  });
});

describe('AllcourseService.updateAllcourseById (mocked DAO)', () => {
  it('delegates to DAO.updateAllcourseById with courseId+payload and returns its result', () => {
    const payload = { name: 'Algebra' };
    const daoResult = { _id: 'c1', name: 'Algebra' };
    AllcourseDAO.updateAllcourseById.mockReturnValue(daoResult);

    const result = AllcourseService.updateAllcourseById('c1', payload);

    expect(AllcourseDAO.updateAllcourseById).toHaveBeenCalledTimes(1);
    expect(AllcourseDAO.updateAllcourseById).toHaveBeenCalledWith(
      'c1',
      payload
    );
    expect(result).toBe(daoResult);
  });
});

describe('AllcourseService.createAllcourse (mocked DAO)', () => {
  it('delegates to DAO.createAllcourse with payload and returns its result', () => {
    const payload = { name: 'Calculus' };
    const daoResult = { _id: 'c3', name: 'Calculus' };
    AllcourseDAO.createAllcourse.mockReturnValue(daoResult);

    const result = AllcourseService.createAllcourse(payload);

    expect(AllcourseDAO.createAllcourse).toHaveBeenCalledTimes(1);
    expect(AllcourseDAO.createAllcourse).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });
});
