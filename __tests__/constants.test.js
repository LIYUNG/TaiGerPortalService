const { needUpdateCourseSelection } = require('../constants');

describe('needUpdateCourseSelection', () => {
  it('should return true if the course is not updated', () => {
    const student = {
      courses: []
    };
    expect(needUpdateCourseSelection(student)).toBe(true);
  });
  it('should return true if the course is not analyzed', () => {
    const student = {
      courses: [{ analysis: { updatedAt: null } }]
    };
    expect(needUpdateCourseSelection(student)).toBe(true);
  });

  it('should return true if the course is analyzed but expired 39 days', () => {
    const student = {
      courses: [
        {
          analysis: {
            updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
          }
        }
      ]
    };
    expect(needUpdateCourseSelection(student)).toBe(true);
  });

  it('should return true if the course is analyzed but expired 39 days', () => {
    const student = {
      courses: [
        {
          analysis: {
            updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
          }
        }
      ]
    };
    expect(needUpdateCourseSelection(student)).toBe(true);
  });
  it('should return false if the course is analyzed but not expired 39 days', () => {
    const student = {
      courses: [
        {
          updatedAt: new Date(Date.now() - 39 * 24 * 60 * 60 * 1000),
          analysis: {
            updatedAt: new Date(Date.now() - 39 * 24 * 60 * 60 * 1000)
          }
        }
      ]
    };
    expect(needUpdateCourseSelection(student)).toBe(false);
  });
});
