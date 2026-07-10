import { BaseQueryBuilder } from './BaseQueryBuilder';

class ApplicationQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
  }

  withApplicationYear(year: unknown) {
    if (year) {
      this.query.application_year = year;
    }
    return this;
  }

  withDecided(decided: unknown) {
    if (decided) {
      this.query.decided = decided;
    }
    return this;
  }

  withClosed(closed: unknown) {
    if (closed) {
      this.query.closed = closed;
    }
    return this;
  }

  withAdmission(admission: unknown) {
    if (admission) {
      this.query.admission = admission;
    }
    return this;
  }

  withFinalEnrolment(finalEnrolment: unknown) {
    if (finalEnrolment !== undefined) {
      this.query.finalEnrolment = finalEnrolment === 'true';
    }
    return this;
  }

  withoutLimit() {
    // `options.limit`/`page` are declared required on the base class (see
    // BaseQueryBuilder) so normal callers get real `number`s; view them
    // through an optional-shaped cast here so `delete` type-checks.
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

export = ApplicationQueryBuilder;
