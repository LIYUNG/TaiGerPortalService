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

  withHasOutsourcedUserId(hasOutsourcedUserId) {
    if (hasOutsourcedUserId === true || hasOutsourcedUserId === 'true') {
      this.query.outsourced_user_id = { $exists: true, $not: { $size: 0 } };
    } else if (
      hasOutsourcedUserId === false ||
      hasOutsourcedUserId === 'false'
    ) {
      this.query.outsourced_user_id = { $exists: true, $size: 0 };
    }
    return this;
  }

  withHasMessages(hasMessages) {
    if (hasMessages === true || hasMessages === 'true') {
      this.query.messages = { $exists: true, $not: { $size: 0 } };
    } else if (hasMessages === false || hasMessages === 'false') {
      this.query.messages = { $exists: true, $size: 0 };
    }
    return this;
  }

  withOutsourcedUserId(outsourcedUserId) {
    if (outsourcedUserId) {
      this.query.outsourced_user_id = outsourcedUserId;
    }
    return this;
  }

  withFileType(fileType) {
    if (fileType) {
      this.query.file_type = fileType;
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
