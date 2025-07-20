const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class DocumentthreadQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withIsFinalVersion(isFinalVersion) {
    if (isFinalVersion === true || isFinalVersion === 'true') {
      this.query.isFinalVersion = true;
    } else if (isFinalVersion === false || isFinalVersion === 'false') {
      this.query.isFinalVersion = false;
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
