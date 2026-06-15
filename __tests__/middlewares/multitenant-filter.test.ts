const { Role } = require('@taiger-common/core');

const { ErrorResponse } = require('../../common/errors');
const { multitenant_filter } = require('../../middlewares/multitenant-filter');

// Mock dependencies
const next = jest.fn();
// const mockErrorResponse = jest.fn();

describe('multitenant_filter middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user role is Student and no mismatch', () => {
    const req = {
      user: { role: Role.Student, _id: 'user_id' },
      params: { studentId: 'user_id' }
    };
    multitenant_filter(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should call next if user role is Guest and no mismatch', () => {
    const req = {
      user: { role: Role.Guest, _id: 'user_id' },
      params: { user_id: 'user_id' }
    };
    multitenant_filter(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should call next if user role is not Student or Guest', () => {
    const req = {
      user: { role: Role.Admin, _id: 'admin_id' },
      params: {}
    };
    multitenant_filter(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should call next with ErrorResponse if there is a mismatch for Student', () => {
    const req = {
      user: { role: Role.Student, _id: 'user_id' },
      params: { studentId: 'other_id' }
    };
    multitenant_filter(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should call next with ErrorResponse if there is a mismatch for Guest', () => {
    const req = {
      user: { role: Role.Guest, _id: 'user_id' },
      params: { user_id: 'other_id' }
    };
    multitenant_filter(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
    expect(next).toHaveBeenCalledTimes(1);
  });
});
