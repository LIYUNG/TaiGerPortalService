import { FilterQuery } from 'mongoose';

export class BaseQueryBuilder {
  // The accumulated Mongo filter. Subclasses assign heterogeneous,
  // model-specific fields (application_year, archiv, receiver_id, ...) onto
  // this, so it isn't tied to a single model's FilterQuery<T> — the
  // Record<string, unknown> shape keeps it a real mongoose FilterQuery type
  // while allowing any key, and remains assignable to the more specific
  // FilterQuery<IApplication>/FilterQuery<IUser>/etc. the DAOs expect.
  query: FilterQuery<Record<string, unknown>>;
  // sort/limit/skip are always populated by the constructor (and stay real
  // `number`/`Record` types, matching what consumers like AuditService's
  // getAuditLogs(filter, options) require). `page` is never set here — it's
  // only ever poked at from subclasses' withoutLimit()/tests — so it's
  // optional. Subclasses that `delete` limit/page do so through a locally
  // cast, more-optional view of this object (see their withoutLimit()); the
  // field itself stays required so callers that don't call withoutLimit()
  // keep getting a real `number`.
  options: {
    sort: Record<string, 1 | -1>;
    limit: number;
    skip: number;
    page?: number;
  };

  constructor() {
    this.query = {};
    this.options = {
      sort: { createdAt: -1 },
      limit: 10,
      skip: 0
    };
  }

  withPagination(page: string | number = 1, limit: string | number = 20) {
    const parsedPage = parseInt(String(page), 10);
    const parsedLimit = parseInt(String(limit), 10);

    // Use defaults if values are invalid (negative or NaN)
    this.options.limit = parsedLimit > 0 ? parsedLimit : 10;
    this.options.skip =
      parsedPage > 0 ? (parsedPage - 1) * this.options.limit : 0;
    return this;
  }
  withSort(field = 'createdAt', order = 'desc') {
    // Ensure field has a default value
    const sortField = field || 'createdAt';
    // Convert order to lowercase and validate
    const sortOrder: 1 | -1 = (order || '').toLowerCase() === 'desc' ? -1 : 1;

    this.options.sort = { [sortField]: sortOrder };
    return this;
  }

  withOrs(ors: FilterQuery<Record<string, unknown>>[]) {
    if (!Array.isArray(ors)) {
      throw new Error('ors must be an array');
    }
    this.query.$or = ors;
    return this;
  }

  build() {
    return {
      filter: this.query,
      options: this.options
    };
  }
}
