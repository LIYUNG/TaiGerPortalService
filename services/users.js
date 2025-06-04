const UserService = {
  async getUserById(req, userId) {
    const user = await req.db.model('User').findById(userId).lean();
    return user;
  },
  async getUsers(req, query) {
    const users = await req.db.model('User').find(query).lean();
    return users;
  }
};

module.exports = UserService;
