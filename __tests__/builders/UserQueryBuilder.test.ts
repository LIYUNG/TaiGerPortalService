import UserQueryBuilder from '../../builders/UserQueryBuilder';

describe('UserQueryBuilder', () => {
  describe('withAgents', () => {
    it('matches a specific agent id', () => {
      const { filter } = new UserQueryBuilder().withAgents('agent123').build();
      expect(filter).toEqual({ agents: 'agent123' });
    });

    it('matches students with no agent when given "none"', () => {
      const { filter } = new UserQueryBuilder().withAgents('none').build();
      expect(filter).toEqual({ 'agents.0': { $exists: false } });
    });

    it('ignores falsy values', () => {
      expect(
        new UserQueryBuilder().withAgents(undefined).build().filter
      ).toEqual({});
      expect(new UserQueryBuilder().withAgents(null).build().filter).toEqual(
        {}
      );
      expect(new UserQueryBuilder().withAgents('').build().filter).toEqual({});
    });
  });

  describe('withEditors', () => {
    it('matches a specific editor id', () => {
      const { filter } = new UserQueryBuilder()
        .withEditors('editor123')
        .build();
      expect(filter).toEqual({ editors: 'editor123' });
    });

    it('matches students with no editor when given "none"', () => {
      const { filter } = new UserQueryBuilder().withEditors('none').build();
      expect(filter).toEqual({ 'editors.0': { $exists: false } });
    });
  });

  describe('withArchiv + withAgents("none")', () => {
    it('does not collide: keeps both the $or (archiv) and the agents.0 filter', () => {
      const { filter } = new UserQueryBuilder()
        .withAgents('none')
        .withArchiv('false')
        .build();
      expect(filter).toEqual({
        'agents.0': { $exists: false },
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });
    });
  });
});
