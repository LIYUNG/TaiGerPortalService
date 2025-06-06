const UserService = {
  async getUserById(req, userId) {
    const user = await req.db.model('User').findById(userId).lean();
    return user;
  },
  async getUsers(req, query) {
    const users = await req.db.model('User').find(query).lean();
    return users;
  },
  async updateUser(req, userId, payload) {
    const user = await req.db
      .model('User')
      .findByIdAndUpdate(userId, payload, { new: true })
      .lean();
    return user;
  }
};

module.exports = UserService;
