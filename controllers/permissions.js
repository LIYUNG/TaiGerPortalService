const _ = require('lodash');
const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const { updatePermissionNotificationEmail } = require('../services/email');
const logger = require('../services/logger');

const getUserPermission = asyncHandler(async (req, res) => {
  const users = await req.db.model('Permission').find({}).lean();
  res.status(200).send({ success: true, data: users });
});

// (O) TODO email notify user
const updateUserPermission = asyncHandler(async (req, res) => {
  const {
    params: { user_id }
  } = req;

  const permissions = await req.db
    .model('Permission')
    .findOneAndUpdate({ user_id }, req.body, {
      upsert: true,
      new: true
    })
    .populate('user_id', 'firstname lastname email')
    .lean();
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
