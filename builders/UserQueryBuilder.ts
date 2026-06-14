import { BaseQueryBuilder } from './BaseQueryBuilder';

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
    if (editors === 'none') {
      // Match students with no editor assigned (empty/missing array). Using
      // `editors.0` keeps this a single field condition so it does not collide
      // with the $or set by withArchiv, and it works in both find() and
      // aggregation $match.
      this.query['editors.0'] = { $exists: false };
    } else if (editors) {
      this.query.editors = editors;
    }
    return this;
  }

  withAgents(agents) {
    if (agents === 'none') {
      // Match students with no agent assigned (empty/missing array). See
      // withEditors for why `agents.0` is used instead of an $or.
      this.query['agents.0'] = { $exists: false };
    } else if (agents) {
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

  withRole(role) {
    if (role) {
      this.query.role = Array.isArray(role) ? { $in: role } : role;
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
