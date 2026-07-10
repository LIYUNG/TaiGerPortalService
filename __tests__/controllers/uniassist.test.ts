// Controller UNIT test for controllers/uniassist (getStudentUniAssist).
//
// The handler is a plain (req, res, next) function (wrapped by asyncHandler), so
// we call it DIRECTLY with fake req/res/next and a MOCKED service layer. No
// route, no middleware, no supertest, no database. We assert ONLY the
// controller's own work: the args forwarded to the services, the role-based
// branching it does (student viewer marks the uni-assist notification read and
// strips attributes), the status + body written to res, and error forwarding to
// next(). Full-stack coverage lives in __tests__/integration/uniassist.test.js.

jest.mock('../../services/students');
jest.mock('../../services/applications');

import StudentServiceModule from '../../services/students';
import ApplicationServiceModule from '../../services/applications';
import UniassistController from '../../controllers/uniassist';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, student } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const StudentService = StudentServiceModule as unknown as MockedModule;
const ApplicationService = ApplicationServiceModule as unknown as MockedModule;

// The controller module uses `export =`, so its members are destructured off
// the default-imported object; the handler itself is an asyncHandler-wrapped
// (req, res) function, but tests call it with an extra `next` arg for the
// forward-to-next() case, so re-type it as a variadic handler.
type ControllerHandler = (...args: unknown[]) => Promise<unknown>;
const { getStudentUniAssist } = UniassistController as unknown as Record<
  string,
  ControllerHandler
>;

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStudentUniAssist', () => {
  it('responds 200 with the student + applications attached and forwards studentId to both services', async () => {
    const fetchedStudent = { _id: studentId, firstname: 'Stu' };
    const applications = [{ _id: 'a1' }, { _id: 'a2' }];
    StudentService.getStudentById.mockResolvedValue(fetchedStudent);
    ApplicationService.getApplicationsByStudentId.mockResolvedValue(
      applications
    );
    const req = mockReq({ user: admin, params: { studentId } });
    const res = mockRes();

    await getStudentUniAssist(req, res, jest.fn());

    expect(StudentService.getStudentById).toHaveBeenCalledWith(studentId);
    expect(ApplicationService.getApplicationsByStudentId).toHaveBeenCalledWith(
      studentId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.applications).toEqual(applications);
    // A non-student viewer must NOT trigger the notification-flag update.
    expect(StudentService.updateStudentById).not.toHaveBeenCalled();
  });

  it('student viewer: marks the uni-assist notification read and strips attributes', async () => {
    const viewer = {
      ...student,
      notification: { isRead_uni_assist_task_assigned: false }
    };
    StudentService.updateStudentById.mockResolvedValue({});
    StudentService.getStudentById.mockResolvedValue({
      _id: studentId,
      attributes: ['secret']
    });
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([]);
    const req = mockReq({ user: viewer, params: { studentId } });
    const res = mockRes();

    await getStudentUniAssist(req, res, jest.fn());

    expect(StudentService.updateStudentById).toHaveBeenCalledWith(
      viewer._id.toString(),
      { notification: { isRead_uni_assist_task_assigned: true } }
    );
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    // attributes are deleted for a student viewer.
    expect(body.data.attributes).toBeUndefined();
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.getStudentById.mockRejectedValue(err);
    const next = jest.fn();

    await getStudentUniAssist(
      mockReq({ user: admin, params: { studentId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
