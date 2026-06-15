const InterviewQueryBuilder = require('../../builders/InterviewQueryBuilder');

describe('InterviewQueryBuilder', () => {
  it('builds an empty filter by default with default options', () => {
    const { filter, options } = new InterviewQueryBuilder().build();
    expect(filter).toEqual({});
    expect(options).toEqual({
      sort: { createdAt: -1 },
      limit: 10,
      skip: 0
    });
  });

  describe('withInterviewId', () => {
    it('adds interviewId when truthy', () => {
      const { filter } = new InterviewQueryBuilder()
        .withInterviewId('int123')
        .build();
      expect(filter).toEqual({ interviewId: 'int123' });
    });

    it('ignores falsy values', () => {
      expect(
        new InterviewQueryBuilder().withInterviewId(undefined).build().filter
      ).toEqual({});
      expect(
        new InterviewQueryBuilder().withInterviewId(null).build().filter
      ).toEqual({});
      expect(
        new InterviewQueryBuilder().withInterviewId('').build().filter
      ).toEqual({});
    });
  });

  describe('withStudentId', () => {
    it('adds studentId when truthy', () => {
      const { filter } = new InterviewQueryBuilder()
        .withStudentId('stu123')
        .build();
      expect(filter).toEqual({ studentId: 'stu123' });
    });

    it('ignores falsy values', () => {
      expect(
        new InterviewQueryBuilder().withStudentId(undefined).build().filter
      ).toEqual({});
    });
  });

  describe('withProgramId', () => {
    it('adds programId when truthy', () => {
      const { filter } = new InterviewQueryBuilder()
        .withProgramId('prog123')
        .build();
      expect(filter).toEqual({ programId: 'prog123' });
    });

    it('ignores falsy values', () => {
      expect(
        new InterviewQueryBuilder().withProgramId(0).build().filter
      ).toEqual({});
    });
  });

  describe('withIsClosed', () => {
    it('adds isClosed when truthy', () => {
      const { filter } = new InterviewQueryBuilder().withIsClosed(true).build();
      expect(filter).toEqual({ isClosed: true });
    });

    it('ignores falsy values', () => {
      expect(
        new InterviewQueryBuilder().withIsClosed(false).build().filter
      ).toEqual({});
      expect(
        new InterviewQueryBuilder().withIsClosed(undefined).build().filter
      ).toEqual({});
    });
  });

  describe('withTrainerId', () => {
    it('maps trainerId to trainer_id when truthy', () => {
      const { filter } = new InterviewQueryBuilder()
        .withTrainerId('trainer123')
        .build();
      expect(filter).toEqual({ trainer_id: 'trainer123' });
    });

    it('ignores falsy values', () => {
      expect(
        new InterviewQueryBuilder().withTrainerId(null).build().filter
      ).toEqual({});
    });
  });

  describe('withoutLimit', () => {
    it('removes limit and page from options', () => {
      const builder = new InterviewQueryBuilder();
      builder.options.page = 3;
      const { options } = builder.withoutLimit().build();
      expect(options.limit).toBeUndefined();
      expect(options.page).toBeUndefined();
      expect(options.skip).toBe(0);
      expect(options.sort).toEqual({ createdAt: -1 });
    });
  });

  describe('chaining', () => {
    it('combines multiple with* calls into a single filter', () => {
      const { filter, options } = new InterviewQueryBuilder()
        .withInterviewId('int1')
        .withStudentId('stu1')
        .withProgramId('prog1')
        .withIsClosed(true)
        .withTrainerId('train1')
        .withoutLimit()
        .build();
      expect(filter).toEqual({
        interviewId: 'int1',
        studentId: 'stu1',
        programId: 'prog1',
        isClosed: true,
        trainer_id: 'train1'
      });
      expect(options.limit).toBeUndefined();
    });

    it('inherits base builder methods (withPagination / withSort / withOrs)', () => {
      const { filter, options } = new InterviewQueryBuilder()
        .withStudentId('stu1')
        .withPagination(2, 5)
        .withSort('updatedAt', 'asc')
        .withOrs([{ a: 1 }, { b: 2 }])
        .build();
      expect(filter).toEqual({
        studentId: 'stu1',
        $or: [{ a: 1 }, { b: 2 }]
      });
      expect(options.limit).toBe(5);
      expect(options.skip).toBe(5);
      expect(options.sort).toEqual({ updatedAt: 1 });
    });

    it('each with* method returns the builder instance (fluent)', () => {
      const builder = new InterviewQueryBuilder();
      expect(builder.withInterviewId('x')).toBe(builder);
      expect(builder.withStudentId('x')).toBe(builder);
      expect(builder.withProgramId('x')).toBe(builder);
      expect(builder.withIsClosed(true)).toBe(builder);
      expect(builder.withTrainerId('x')).toBe(builder);
      expect(builder.withoutLimit()).toBe(builder);
    });
  });
});
