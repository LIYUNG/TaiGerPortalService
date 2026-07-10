import { BaseQueryBuilder } from './BaseQueryBuilder';

class DocumentthreadQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withIsFinalVersion(isFinalVersion: unknown) {
    if (isFinalVersion === true || isFinalVersion === 'true') {
      this.query.isFinalVersion = true;
    } else if (isFinalVersion === false || isFinalVersion === 'false') {
      this.query.isFinalVersion = false;
    }
    return this;
  }

  withHasOutsourcedUserId(hasOutsourcedUserId: unknown) {
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

  withHasMessages(hasMessages: unknown) {
    if (hasMessages === true || hasMessages === 'true') {
      this.query.messages = { $exists: true, $not: { $size: 0 } };
    } else if (hasMessages === false || hasMessages === 'false') {
      this.query.messages = { $exists: true, $size: 0 };
    }
    return this;
  }

  withOutsourcedUserId(outsourcedUserId: unknown) {
    if (outsourcedUserId) {
      this.query.outsourced_user_id = outsourcedUserId;
    }
    return this;
  }

  withFileType(fileType: unknown) {
    if (fileType) {
      this.query.file_type = fileType;
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

export = DocumentthreadQueryBuilder;
