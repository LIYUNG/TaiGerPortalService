// Unit tests for builders/DocumentthreadQueryBuilder. Pure query-object builder
// (extends BaseQueryBuilder) — no DB, no mocks needed. Each `withX` toggles a
// branch of the built `filter`; `withoutLimit` strips pagination from `options`.
const DocumentthreadQueryBuilder = require('../../builders/DocumentthreadQueryBuilder');

describe('DocumentthreadQueryBuilder', () => {
  describe('withIsFinalVersion', () => {
    it('sets isFinalVersion true for boolean true and string "true"', () => {
      expect(
        new DocumentthreadQueryBuilder().withIsFinalVersion(true).build().filter
      ).toEqual({ isFinalVersion: true });
      expect(
        new DocumentthreadQueryBuilder().withIsFinalVersion('true').build()
          .filter
      ).toEqual({ isFinalVersion: true });
    });

    it('sets isFinalVersion false for boolean false and string "false"', () => {
      expect(
        new DocumentthreadQueryBuilder().withIsFinalVersion(false).build()
          .filter
      ).toEqual({ isFinalVersion: false });
      expect(
        new DocumentthreadQueryBuilder().withIsFinalVersion('false').build()
          .filter
      ).toEqual({ isFinalVersion: false });
    });

    it('ignores undefined / other values', () => {
      expect(
        new DocumentthreadQueryBuilder().withIsFinalVersion(undefined).build()
          .filter
      ).toEqual({});
      expect(
        new DocumentthreadQueryBuilder().withIsFinalVersion('maybe').build()
          .filter
      ).toEqual({});
    });
  });

  describe('withHasOutsourcedUserId', () => {
    it('builds a non-empty existence filter for truthy', () => {
      expect(
        new DocumentthreadQueryBuilder().withHasOutsourcedUserId(true).build()
          .filter
      ).toEqual({
        outsourced_user_id: { $exists: true, $not: { $size: 0 } }
      });
      expect(
        new DocumentthreadQueryBuilder().withHasOutsourcedUserId('true').build()
          .filter
      ).toEqual({
        outsourced_user_id: { $exists: true, $not: { $size: 0 } }
      });
    });

    it('builds an empty-array filter for falsy', () => {
      expect(
        new DocumentthreadQueryBuilder().withHasOutsourcedUserId(false).build()
          .filter
      ).toEqual({ outsourced_user_id: { $exists: true, $size: 0 } });
      expect(
        new DocumentthreadQueryBuilder()
          .withHasOutsourcedUserId('false')
          .build().filter
      ).toEqual({ outsourced_user_id: { $exists: true, $size: 0 } });
    });

    it('ignores undefined', () => {
      expect(
        new DocumentthreadQueryBuilder()
          .withHasOutsourcedUserId(undefined)
          .build().filter
      ).toEqual({});
    });
  });

  describe('withHasMessages', () => {
    it('builds a non-empty messages filter for truthy', () => {
      expect(
        new DocumentthreadQueryBuilder().withHasMessages(true).build().filter
      ).toEqual({ messages: { $exists: true, $not: { $size: 0 } } });
      expect(
        new DocumentthreadQueryBuilder().withHasMessages('true').build().filter
      ).toEqual({ messages: { $exists: true, $not: { $size: 0 } } });
    });

    it('builds an empty messages filter for falsy', () => {
      expect(
        new DocumentthreadQueryBuilder().withHasMessages(false).build().filter
      ).toEqual({ messages: { $exists: true, $size: 0 } });
      expect(
        new DocumentthreadQueryBuilder().withHasMessages('false').build().filter
      ).toEqual({ messages: { $exists: true, $size: 0 } });
    });

    it('ignores undefined', () => {
      expect(
        new DocumentthreadQueryBuilder().withHasMessages(undefined).build()
          .filter
      ).toEqual({});
    });
  });

  describe('withOutsourcedUserId', () => {
    it('sets the outsourced_user_id when truthy', () => {
      expect(
        new DocumentthreadQueryBuilder().withOutsourcedUserId('user1').build()
          .filter
      ).toEqual({ outsourced_user_id: 'user1' });
    });

    it('ignores falsy', () => {
      expect(
        new DocumentthreadQueryBuilder().withOutsourcedUserId(undefined).build()
          .filter
      ).toEqual({});
      expect(
        new DocumentthreadQueryBuilder().withOutsourcedUserId('').build().filter
      ).toEqual({});
    });
  });

  describe('withFileType', () => {
    it('sets the file_type when truthy', () => {
      expect(
        new DocumentthreadQueryBuilder().withFileType('Essay').build().filter
      ).toEqual({ file_type: 'Essay' });
    });

    it('ignores falsy', () => {
      expect(
        new DocumentthreadQueryBuilder().withFileType(undefined).build().filter
      ).toEqual({});
    });
  });

  describe('withoutLimit', () => {
    it('removes limit and page from options', () => {
      const builder = new DocumentthreadQueryBuilder();
      builder.options.limit = 50;
      builder.options.page = 2;
      const { options } = builder.withoutLimit().build();
      expect(options).not.toHaveProperty('limit');
      expect(options).not.toHaveProperty('page');
    });
  });

  describe('build / chaining', () => {
    it('returns { filter, options } and chains multiple withX calls', () => {
      const result = new DocumentthreadQueryBuilder()
        .withFileType('ML')
        .withIsFinalVersion(true)
        .withHasMessages(true)
        .build();

      expect(result).toEqual({
        filter: {
          file_type: 'ML',
          isFinalVersion: true,
          messages: { $exists: true, $not: { $size: 0 } }
        },
        options: expect.objectContaining({ sort: { createdAt: -1 } })
      });
    });

    it('inherits BaseQueryBuilder options defaults', () => {
      const { options } = new DocumentthreadQueryBuilder().build();
      expect(options).toEqual({
        sort: { createdAt: -1 },
        limit: 10,
        skip: 0
      });
    });
  });
});
