const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class UserQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withArchiv(archiv) {
    if (archiv === true || archiv === 'true') {
      this.query.archiv = true;
    } else if (archiv === false || archiv === 'false') {
      this.query.$or = [{ archiv: { $exists: false } }, { archiv: false }];
    }
    return this;
  }

  withEditors(editors) {
    if (editors) {
      this.query.editors = editors;
    }
    return this;
  }

  withAgents(agents) {
    if (agents) {
      this.query.agents = agents;
    }
    return this;
  }

  withNeedEditor(needEditor) {
    if (needEditor || needEditor === 'true') {
      this.query.needEditor = needEditor;
    } else if (needEditor === false || needEditor === 'false') {
      this.query.needEditor = false;
    }
    return this;
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
