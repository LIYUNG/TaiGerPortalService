// Controller UNIT test for controllers/portal_informations.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and the service layer
// (StudentService/ApplicationService) mocked. No route, no middleware, no DB —
// only the controller's own work: the args it forwards, the way it reshapes the
// body into nested portal_credentials, the status + body it writes, and that a
// service error / not-found is forwarded to next(). Full-stack coverage (route ->
// service -> dao -> in-memory Mongo) lives in __tests__/integration/portal_information.test.js.

jest.mock('../../services/students');
jest.mock('../../services/applications');

import StudentService from '../../services/students';
import ApplicationService from '../../services/applications';
import {
  getPortalCredentials,
  createPortalCredentials
} from '../../controllers/portal_informations';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { student } from '../mock/user';

const studentId = student._id.toString();
const applicationId = '5f9f1b9b9c9d440000d1d1d1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPortalCredentials', () => {
  it('responds 200 with the student projection + applications and forwards the studentId', async () => {
    const theStudent = {
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      agents: ['a1'],
      editors: ['e1'],
      secret: 'should-not-leak'
    };
    StudentService.getStudentById.mockResolvedValue(theStudent);
    const apps = [{ _id: applicationId, portal_credentials: {} }];
    ApplicationService.getApplicationsWithCredentialsByStudentId.mockResolvedValue(
      apps
    );
    const res = mockRes();

    await getPortalCredentials(
      mockReq({ params: { studentId } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentById).toHaveBeenCalledWith(studentId);
    expect(
      ApplicationService.getApplicationsWithCredentialsByStudentId
    ).toHaveBeenCalledWith(studentId);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.applications).toEqual(apps);
    // Only the whitelisted student fields are returned.
    expect(body.data.student).toEqual({
      _id: student._id,
      firstname: 'Stu',
      lastname: 'Dent',
      agents: ['a1'],
      editors: ['e1']
    });
    expect(body.data.student.secret).toBeUndefined();
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.getStudentById.mockRejectedValue(err);
    const next = jest.fn();

    await getPortalCredentials(
      mockReq({ params: { studentId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('createPortalCredentials', () => {
  it('maps the flat body into nested portal_credentials and responds with the updated application', async () => {
    const updated = {
      _id: applicationId,
      portal_credentials: {
        application_portal_a: { account: 'a', password: 'pa' },
        application_portal_b: { account: 'b', password: 'pb' }
      }
    };
    ApplicationService.updateApplication.mockResolvedValue(updated);
    const res = mockRes();

    await createPortalCredentials(
      mockReq({
        params: { studentId, applicationId },
        body: {
          account_portal_a: 'a',
          password_portal_a: 'pa',
          account_portal_b: 'b',
          password_portal_b: 'pb'
        }
      }),
      res,
      jest.fn()
    );

    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: applicationId },
      {
        portal_credentials: {
          application_portal_a: { account: 'a', password: 'pa' },
          application_portal_b: { account: 'b', password: 'pb' }
        }
      }
    );
    // This handler uses res.send(...) without a preceding res.status().
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('forwards a 400 ErrorResponse to next() when the application is not found', async () => {
    ApplicationService.updateApplication.mockResolvedValue(null);
    const next = jest.fn();

    await createPortalCredentials(
      mockReq({
        params: { studentId, applicationId },
        body: { account_portal_a: 'a', password_portal_a: 'pa' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});
