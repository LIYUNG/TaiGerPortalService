class BaseQueryBuilder {
  constructor() {
    this.query = {};
    this.options = {
      sort: { createdAt: -1 },
      limit: 10,
      skip: 0
    };
  }

  withPagination(page = 1, limit = 20) {
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);

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
    const sortOrder = (order || '').toLowerCase() === 'desc' ? -1 : 1;

    this.options.sort = { [sortField]: sortOrder };
    return this;
  }

  withOrs(ors) {
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

module.exports = { BaseQueryBuilder };
