const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class UserQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withChatRoomId(chatRoomId) {
    if (chatRoomId) {
      this.query.chatRoomId = chatRoomId;
    }
    return this;
  }

  withRole(role) {
    if (role) {
      this.query.role = role;
    }
    return this;
  }

  withoutLimit() {
    delete this.options.limit;
    delete this.options.page;
    return this;
  }

  build() {
    return {
      filter: this.query,
      options: this.options
    };
  }
}

module.exports = UserQueryBuilder;
