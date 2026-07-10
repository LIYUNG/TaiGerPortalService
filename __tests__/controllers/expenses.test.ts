// Controller UNIT test for controllers/expenses.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and the service layer
// (StudentService/UserService) mocked. No route, no middleware, no DB — only the
// controller's own work: the args it forwards, the role branching/merging it
// performs, the status + body it writes, and that a service error is forwarded
// to next(). Full-stack coverage (route -> service -> dao -> in-memory Mongo)
// lives in __tests__/integration/expenses.test.js.

jest.mock('../../services/students');
jest.mock('../../services/users');

import { Role } from '@taiger-common/core';
import StudentServiceModule from '../../services/students';
import UserServiceModule from '../../services/users';
import ExpensesController from '../../controllers/expenses';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, agent, editor, student } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const StudentService = StudentServiceModule as unknown as MockedModule;
const UserService = UserServiceModule as unknown as MockedModule;

// The controller module uses `export =`, so its members are destructured off
// the default-imported object; the handlers themselves are asyncHandler-wrapped
// (req, res) functions, but tests call them with an extra `next` arg for the
// forward-to-next() cases, so re-type each as a variadic handler.
type ControllerHandler = (...args: unknown[]) => Promise<unknown>;
const { getExpenses, getExpense, syncExpense } =
  ExpensesController as unknown as Record<string, ControllerHandler>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getExpenses', () => {
  it('responds 200 with the taiger users with expenses the service resolves', async () => {
    const data = [{ _id: 'u1', total: 10 }];
    StudentService.getTaigerUsersWithExpenses.mockResolvedValue(data);
    const res = mockRes();

    await getExpenses(mockReq(), res, jest.fn());

    expect(StudentService.getTaigerUsersWithExpenses).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.getTaigerUsersWithExpenses.mockRejectedValue(err);
    const next = jest.fn();

    await getExpenses(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getExpense', () => {
  it('agent branch: queries students by the agents field and merges the aggregate totals', async () => {
    const targetId = agent._id.toString();
    const theUser = { _id: agent._id, role: Role.Agent };
    UserService.getUserById.mockResolvedValue(theUser);
    StudentService.getStudentsWithExpenses.mockResolvedValue([
      { _id: student._id, total: 42 }
    ]);
    StudentService.getStudentsForExpenses.mockResolvedValue([
      { _id: student._id, firstname: 'S' }
    ]);
    const res = mockRes();

    await getExpense(
      mockReq({ params: { taiger_user_id: targetId } }),
      res,
      jest.fn()
    );

    expect(UserService.getUserById).toHaveBeenCalledWith(targetId);
    expect(StudentService.getStudentsForExpenses).toHaveBeenCalledWith({
      agents: agent._id.toString(),
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    // Aggregate (total) merged with the student doc.
    expect(body.data.students[0]).toMatchObject({ total: 42, firstname: 'S' });
    expect(body.data.the_user).toBe(theUser);
  });

  it('editor branch: queries students by the editors field', async () => {
    const targetId = editor._id.toString();
    UserService.getUserById.mockResolvedValue({
      _id: editor._id,
      role: Role.Editor
    });
    StudentService.getStudentsWithExpenses.mockResolvedValue([]);
    StudentService.getStudentsForExpenses.mockResolvedValue([]);
    const res = mockRes();

    await getExpense(
      mockReq({ params: { taiger_user_id: targetId } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentsForExpenses).toHaveBeenCalledWith({
      editors: editor._id.toString(),
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].success).toBe(true);
  });

  it('admin branch: returns an empty students list (admin is neither agent nor editor)', async () => {
    const theUser = { _id: admin._id, role: Role.Admin };
    UserService.getUserById.mockResolvedValue(theUser);
    StudentService.getStudentsWithExpenses.mockResolvedValue([]);
    const res = mockRes();

    await getExpense(
      mockReq({ params: { taiger_user_id: admin._id.toString() } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentsForExpenses).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { students: [], the_user: theUser }
    });
  });

  it('forwards a 401 ErrorResponse to next() when the target user is not TaiGer staff', async () => {
    UserService.getUserById.mockResolvedValue({
      _id: student._id,
      role: Role.Student
    });
    const next = jest.fn();

    await getExpense(
      mockReq({ params: { taiger_user_id: student._id.toString() } }),
      mockRes(),
      next
    );

    expect(StudentService.getStudentsForExpenses).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });
});

describe('syncExpense', () => {
  it('responds 200 with all users from the service', async () => {
    const users = [{ _id: 'u1' }, { _id: 'u2' }];
    UserService.getUsers.mockResolvedValue(users);
    const res = mockRes();

    await syncExpense(mockReq(), res, jest.fn());

    expect(UserService.getUsers).toHaveBeenCalledWith({});
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: users });
  });
});
