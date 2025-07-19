const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class DocumentthreadQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withIsFinalVersion(isFinalVersion) {
    if (isFinalVersion) {
      this.query.isFinalVersion = Boolean(isFinalVersion);
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

module.exports = DocumentthreadQueryBuilder;
