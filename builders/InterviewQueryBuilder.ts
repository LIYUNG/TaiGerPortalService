import { BaseQueryBuilder } from './BaseQueryBuilder';

class InterviewQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withInterviewId(interviewId: unknown) {
    if (interviewId) {
      this.query.interviewId = interviewId;
    }
    return this;
  }

  withStudentId(studentId: unknown) {
    if (studentId) {
      this.query.studentId = studentId;
    }
    return this;
  }

  withProgramId(programId: unknown) {
    if (programId) {
      this.query.programId = programId;
    }
    return this;
  }

  withIsClosed(isClosed: unknown) {
    if (isClosed) {
      this.query.isClosed = isClosed;
    }
    return this;
  }

  withTrainerId(trainerId: unknown) {
    if (trainerId) {
      this.query.trainer_id = trainerId;
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

export = InterviewQueryBuilder;
