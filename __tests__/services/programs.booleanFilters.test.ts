import ProgramService from '../../services/programs';
import ProgramDAO from '../../dao/program.dao';

jest.mock('../../dao/program.dao', () => ({
  __esModule: true,
  default: {
    findProgramsPaginated: jest.fn().mockResolvedValue([[], 0])
  }
}));

const findProgramsPaginated =
  ProgramDAO.findProgramsPaginated as jest.MockedFunction<
    typeof ProgramDAO.findProgramsPaginated
  >;

/** The $and conditions the service handed to Mongo for a given query. */
const conditionsFor = async (query: Record<string, unknown>) => {
  findProgramsPaginated.mockClear();
  await ProgramService.getProgramsPaginated(query);
  const call = findProgramsPaginated.mock.calls[0][0];
  return (call.filter.$and ?? []) as Record<string, unknown>[];
};

describe('program list boolean school filters', () => {
  it.each(['isPrivateSchool', 'isPartnerSchool', 'isNC'])(
    '%s=true matches the flag exactly (no regex)',
    async (field) => {
      const conditions = await conditionsFor({ [field]: 'true' });
      expect(conditions).toContainEqual({ [field]: true });
    }
  );

  it.each(['isPrivateSchool', 'isPartnerSchool', 'isNC'])(
    '%s=false also matches legacy programs where the flag is absent',
    async (field) => {
      const conditions = await conditionsFor({ [field]: 'false' });
      // Programs created before the flag existed have no such key at all;
      // treating "not private" as `{field: false}` alone would silently hide them.
      expect(conditions).toContainEqual({
        $or: [{ [field]: { $exists: false } }, { [field]: false }]
      });
    }
  );

  it('does not filter at all when the flag is unset', async () => {
    const conditions = await conditionsFor({});
    const mentionsFlag = JSON.stringify(conditions).includes('isPrivateSchool');
    expect(mentionsFlag).toBe(false);
  });

  it('ignores a value that is not literally true/false', async () => {
    const conditions = await conditionsFor({ isPrivateSchool: 'yes' });
    const mentionsFlag = JSON.stringify(conditions).includes('isPrivateSchool');
    expect(mentionsFlag).toBe(false);
  });

  it('returns the flags to the client (they are in the list projection)', async () => {
    findProgramsPaginated.mockClear();
    await ProgramService.getProgramsPaginated({});
    const { select } = findProgramsPaginated.mock.calls[0][0];
    expect(select).toContain('isPrivateSchool');
    expect(select).toContain('isPartnerSchool');
    expect(select).toContain('isNC');
  });
});
