import { asyncHandler } from '../middlewares/error-handler';
import { updatePermissionNotificationEmail } from '../services/email';
import PermissionService from '../services/permissions';

const getUserPermission = asyncHandler(async (req, res) => {
  const users = await PermissionService.getPermissions({});
  res.status(200).send({ success: true, data: users });
});

// (O) TODO email notify user
const updateUserPermission = asyncHandler(async (req, res) => {
  const {
    params: { user_id }
  } = req;

  const permissions = await PermissionService.upsertPermissionByUserId(
    user_id,
    req.body
  );
  // TODO: delete permission cache!

  res.status(200).send({ success: true, data: permissions });
  if (!permissions) {
    return;
  }
  const permission_user = (permissions as any).user_id;
  // Email inform user, the updated status
  updatePermissionNotificationEmail(
    {
      firstname: permission_user.firstname,
      lastname: permission_user.lastname,
      address: permission_user.email
    },
    {}
  );
});

export = {
  getUserPermission,
  updateUserPermission
};
