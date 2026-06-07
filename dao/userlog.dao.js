const { Userlog } = require('../models');

const USER_POPULATE = ['user_id', 'firstname lastname role'];

/**
 * UserlogDAO — data access for the Userlog model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const UserlogDAO = {
  async getUserlogs() {
    return Userlog.find()
      .populate(...USER_POPULATE)
      .sort({ createdAt: -1 });
  },

  async getUserlogsByUserId(userId) {
    return Userlog.find({ user_id: userId })
      .populate(...USER_POPULATE)
      .sort({ createdAt: -1 });
  }
};

module.exports = UserlogDAO;
