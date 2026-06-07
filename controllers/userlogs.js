const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const UserlogService = require('../services/userlogs');
const UserService = require('../services/users');

const getUserslog = asyncHandler(async (req, res) => {
  const userlogs = await UserlogService.getUserlogs();
  res.send({ success: true, data: userlogs });
});

const getUserlog = asyncHandler(async (req, res) => {
  const user = await UserService.getUserById(req.params.user_id);
  if (!user) {
    logger.error('getUserlog: Invalid user_id');
    throw new ErrorResponse(404, 'User not found');
  }
  const userlog = await UserlogService.getUserlogsByUserId(req.params.user_id);
  res.send({ success: true, data: userlog, user });
});

module.exports = {
  getUserslog,
  getUserlog
};
