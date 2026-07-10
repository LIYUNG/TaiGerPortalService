// Controller UNIT test for controllers/permissions.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next, the PermissionService mocked,
// and the outbound notification email mocked. No route, no middleware, no DB —
// only the controller's own work: the args it forwards to the service, the
// status + body it writes, that it fires the notification email on an update,
// and that a service error is forwarded to next(). Full-stack coverage (route ->
// service -> dao -> in-memory Mongo) lives in __tests__/integration/permissions.test.js.

jest.mock('../../services/permissions');
jest.mock('../../services/email', () => ({
  updatePermissionNotificationEmail: jest.fn()
}));

import PermissionServiceModule from '../../services/permissions';
import { updatePermissionNotificationEmail } from '../../services/email';
import PermissionsControllerModule from '../../controllers/permissions';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { agent } from '../mock/user';

// Auto-mocked module exposes jest.fn()s at runtime, but TS still sees the
// real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const PermissionService = PermissionServiceModule as unknown as MockedModule;

// The controller handlers are asyncHandler-wrapped: asyncHandler's exposed
// type mirrors the wrapped fn's OWN param count (2 for a plain (req, res)
// handler), while the runtime wrapper always forwards a 3rd `next` used
// internally for `.catch(next)`. Re-type the whole module so tests can call
// each handler with (req, res, next) uniformly without under/over-arg errors.
type Handler = (...args: unknown[]) => unknown;
const { getUserPermission, updateUserPermission } =
  PermissionsControllerModule as unknown as Record<string, Handler>;

const userId = agent._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUserPermission', () => {
  it('responds 200 with the full permissions list (filter {}) regardless of the path id', async () => {
    const data = [{ _id: 'p1', user_id: agent._id, canAssignAgents: true }];
    PermissionService.getPermissions.mockResolvedValue(data);
    const res = mockRes();

    await getUserPermission(
      mockReq({ params: { user_id: userId } }),
      res,
      jest.fn()
    );

    // Controller fetches the full list (filter {}); the path id is not used.
    expect(PermissionService.getPermissions).toHaveBeenCalledWith({});
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    PermissionService.getPermissions.mockRejectedValue(err);
    const next = jest.fn();

    await getUserPermission(
      mockReq({ params: { user_id: userId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updateUserPermission', () => {
  it('upserts via the service (user_id + body), responds 200, and fires the notification email', async () => {
    const saved = {
      user_id: { firstname: 'A', lastname: 'B', email: 'a@b.c' },
      canAssignAgents: true
    };
    PermissionService.upsertPermissionByUserId.mockResolvedValue(saved);
    const body = { canAssignAgents: true, canAssignEditors: false };
    const res = mockRes();

    await updateUserPermission(
      mockReq({ params: { user_id: userId }, body }),
      res,
      jest.fn()
    );

    expect(PermissionService.upsertPermissionByUserId).toHaveBeenCalledWith(
      userId,
      body
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: saved });
    // Email built from the populated user_id of the upserted permission.
    expect(updatePermissionNotificationEmail).toHaveBeenCalledWith({
      firstname: 'A',
      lastname: 'B',
      address: 'a@b.c'
    });
  });

  it('forwards a service error to next() and does not send the email', async () => {
    const err = new Error('db down');
    PermissionService.upsertPermissionByUserId.mockRejectedValue(err);
    const next = jest.fn();

    await updateUserPermission(
      mockReq({ params: { user_id: userId }, body: {} }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
    expect(updatePermissionNotificationEmail).not.toHaveBeenCalled();
  });
});
