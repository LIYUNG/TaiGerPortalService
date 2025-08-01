const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class ApplicationQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withDecided(decided) {
    if (decided) {
      this.query.decided = decided;
    }
    return this;
  }

  withClosed(closed) {
    if (closed) {
      this.query.closed = closed;
    }
    return this;
  }

  withAdmission(admission) {
    if (admission) {
      this.query.admission = admission;
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

module.exports = ApplicationQueryBuilder;
