const { asyncHandler } = require('../middlewares/error-handler');
const { updatePermissionNotificationEmail } = require('../services/email');
const PermissionService = require('../services/permissions');

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
  // Email inform user, the updated status
  updatePermissionNotificationEmail(
    {
      firstname: permissions.user_id.firstname,
      lastname: permissions.user_id.lastname,
      address: permissions.user_id.email
    },
    {}
  );
});

module.exports = {
  getUserPermission,
  updateUserPermission
};
