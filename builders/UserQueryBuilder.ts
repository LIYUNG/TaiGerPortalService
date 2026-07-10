import { BaseQueryBuilder } from './BaseQueryBuilder';

class UserQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withArchiv(archiv: unknown) {
    if (archiv === true || archiv === 'true') {
      this.query.archiv = true;
    } else if (archiv === false || archiv === 'false') {
      this.query.$or = [{ archiv: { $exists: false } }, { archiv: false }];
    }
    return this;
  }

  withEditors(editors: unknown) {
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

  withAgents(agents: unknown) {
    if (agents === 'none') {
      // Match students with no agent assigned (empty/missing array). See
      // withEditors for why `agents.0` is used instead of an $or.
      this.query['agents.0'] = { $exists: false };
    } else if (agents) {
      this.query.agents = agents;
    }
    return this;
  }

  withNeedEditor(needEditor: unknown) {
    if (needEditor || needEditor === 'true') {
      this.query.needEditor = needEditor;
    } else if (needEditor === false || needEditor === 'false') {
      this.query.needEditor = false;
    }
    return this;
  }

  withRole(role: unknown) {
    if (role) {
      this.query.role = Array.isArray(role) ? { $in: role } : role;
    }
    return this;
  }

  withoutLimit() {
    // See ApplicationQueryBuilder.withoutLimit for why the cast is needed.
    delete (this.options as { limit?: number; page?: number }).limit;
    delete (this.options as { limit?: number; page?: number }).page;
    return this;
  }

  build() {
    return {
      filter: this.query,
      options: this.options
    };
  }
}

export = UserQueryBuilder;
