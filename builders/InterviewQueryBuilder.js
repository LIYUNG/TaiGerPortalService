const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class UserQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withInterviewId(interviewId) {
    if (interviewId) {
      this.query.interviewId = interviewId;
    }
    return this;
  }

  withStudentId(studentId) {
    if (studentId) {
      this.query.studentId = studentId;
    }
    return this;
  }

  withProgramId(programId) {
    if (programId) {
      this.query.programId = programId;
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
