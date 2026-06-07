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
  },

  async findOneUserlog(filter) {
    return Userlog.findOne(filter);
  },

  // Increment the per-day API-call counter for this user/path/operation,
  // creating the row when `upsert` is set.
  async incrementUserlogCount(filter, { upsert = false } = {}) {
    return Userlog.findOneAndUpdate(
      filter,
      { $inc: { apiCallCount: 1 } },
      {
        upsert
      }
    );
  }
};

module.exports = UserlogDAO;
