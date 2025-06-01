const UserService = {
  async getUserById(req, userId) {
    const user = await req.db.model('User').findById(userId);
    return user;
  }
};

module.exports = UserService;
