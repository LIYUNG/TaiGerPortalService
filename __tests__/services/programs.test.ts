// ProgramService is mostly thin pass-throughs to ProgramDAO, but owns real
// query-parsing/filter-building logic (parseProgramsQuery, the private
// buildProgramsFilter used by getProgramsPaginated). This is a UNIT test: the
// DAO is mocked so no database is touched. The parsing/filter logic is asserted
// directly; the paginated read is asserted for both its DAO call shape and its
// composed return value.
jest.mock('../../dao/program.dao');

import ProgramDAOReal from '../../dao/program.dao';
import ProgramService from '../../services/programs';

const ProgramDAO = ProgramDAOReal as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Thin pass-throughs ──────────────────────────────────────────────────────
describe('ProgramService thin DAO delegators', () => {
  it('getPrograms delegates to DAO.findPrograms with filter', async () => {
    const filter = { school: 'A' };
    const daoResult = [{ _id: 'p1' }];
    ProgramDAO.findPrograms.mockResolvedValue(daoResult);

    const result = await ProgramService.getPrograms(filter);

    expect(ProgramDAO.findPrograms).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.findPrograms).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getPrograms defaults filter to {} when omitted', async () => {
    ProgramDAO.findPrograms.mockResolvedValue([]);

    await ProgramService.getPrograms();

    expect(ProgramDAO.findPrograms).toHaveBeenCalledWith({});
  });

  it('getProgramByIdLean delegates to DAO.getProgramByIdLean', async () => {
    const daoResult = { _id: 'p1' };
    ProgramDAO.getProgramByIdLean.mockResolvedValue(daoResult);

    const result = await ProgramService.getProgramByIdLean('p1');

    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledWith('p1');
    expect(result).toBe(daoResult);
  });

  it('getProgramByIdSelect delegates to DAO.getProgramByIdSelect with id+select', async () => {
    const daoResult = { _id: 'p1', school: 'A' };
    ProgramDAO.getProgramByIdSelect.mockResolvedValue(daoResult);

    const result = await ProgramService.getProgramByIdSelect('p1', 'school');

    expect(ProgramDAO.getProgramByIdSelect).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.getProgramByIdSelect).toHaveBeenCalledWith(
      'p1',
      'school'
    );
    expect(result).toBe(daoResult);
  });

  it('findPrograms delegates to DAO.findPrograms with filter', async () => {
    const filter = { country: 'DE' };
    const daoResult = [{ _id: 'p1' }];
    ProgramDAO.findPrograms.mockResolvedValue(daoResult);

    const result = await ProgramService.findPrograms(filter);

    expect(ProgramDAO.findPrograms).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.findPrograms).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('aggregatePrograms delegates to DAO.aggregatePrograms with pipeline', async () => {
    const pipeline = [{ $match: {} }];
    const daoResult = [{ _id: 'p1' }];
    ProgramDAO.aggregatePrograms.mockResolvedValue(daoResult);

    const result = await ProgramService.aggregatePrograms(pipeline);

    expect(ProgramDAO.aggregatePrograms).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.aggregatePrograms).toHaveBeenCalledWith(pipeline);
    expect(result).toBe(daoResult);
  });

  it('countPrograms delegates to DAO.countPrograms with filter', async () => {
    ProgramDAO.countPrograms.mockResolvedValue(5);

    const result = await ProgramService.countPrograms({ school: 'A' });

    expect(ProgramDAO.countPrograms).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.countPrograms).toHaveBeenCalledWith({ school: 'A' });
    expect(result).toBe(5);
  });

  it('findProgramsQuery delegates to DAO.findProgramsQuery with filter+options', async () => {
    const filter = { school: 'A' };
    const options = { lean: true };
    const daoResult = [{ _id: 'p1' }];
    ProgramDAO.findProgramsQuery.mockResolvedValue(daoResult);

    const result = await ProgramService.findProgramsQuery(
      filter,
      options as any
    );

    expect(ProgramDAO.findProgramsQuery).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.findProgramsQuery).toHaveBeenCalledWith(filter, options);
    expect(result).toBe(daoResult);
  });

  it('getProgramById delegates to DAO.getProgramByIdLean', async () => {
    const daoResult = { _id: 'p1' };
    ProgramDAO.getProgramByIdLean.mockResolvedValue(daoResult);

    const result = await ProgramService.getProgramById('p1');

    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledWith('p1');
    expect(result).toBe(daoResult);
  });

  it('createProgram delegates to DAO.createProgram with payload', async () => {
    const payload = { school: 'A' };
    const daoResult = { _id: 'p1' };
    ProgramDAO.createProgram.mockResolvedValue(daoResult);

    const result = await ProgramService.createProgram(payload);

    expect(ProgramDAO.createProgram).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.createProgram).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('updateProgramOne delegates to DAO.updateProgramOne with filter+fields', async () => {
    const filter = { _id: 'p1' };
    const fields = { school: 'B' };
    const daoResult = { modifiedCount: 1 };
    ProgramDAO.updateProgramOne.mockResolvedValue(daoResult);

    const result = await ProgramService.updateProgramOne(filter, fields);

    expect(ProgramDAO.updateProgramOne).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.updateProgramOne).toHaveBeenCalledWith(filter, fields);
    expect(result).toBe(daoResult);
  });

  it('updateProgramById delegates to DAO.updateProgramById with id+fields', async () => {
    const fields = { school: 'B' };
    const daoResult = { _id: 'p1', school: 'B' };
    ProgramDAO.updateProgramById.mockResolvedValue(daoResult);

    const result = await ProgramService.updateProgramById('p1', fields);

    expect(ProgramDAO.updateProgramById).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.updateProgramById).toHaveBeenCalledWith('p1', fields);
    expect(result).toBe(daoResult);
  });

  it('updateManyPrograms delegates to DAO.updateManyPrograms with filter+update+options', async () => {
    const filter = { country: 'DE' };
    const update = { $set: { tags: ['x'] } };
    const options = { upsert: false };
    const daoResult = { modifiedCount: 3 };
    ProgramDAO.updateManyPrograms.mockResolvedValue(daoResult);

    const result = await ProgramService.updateManyPrograms(
      filter,
      update,
      options
    );

    expect(ProgramDAO.updateManyPrograms).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.updateManyPrograms).toHaveBeenCalledWith(
      filter,
      update,
      options
    );
    expect(result).toBe(daoResult);
  });

  it('archiveProgramById delegates to DAO.archiveProgramById with id', async () => {
    const daoResult = { _id: 'p1', isArchiv: true };
    ProgramDAO.archiveProgramById.mockResolvedValue(daoResult);

    const result = await ProgramService.archiveProgramById('p1');

    expect(ProgramDAO.archiveProgramById).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.archiveProgramById).toHaveBeenCalledWith('p1');
    expect(result).toBe(daoResult);
  });
});

// ── Real logic: parseProgramsQuery ──────────────────────────────────────────
describe('ProgramService.parseProgramsQuery (real logic, no DAO)', () => {
  it('applies safe defaults for an empty query', () => {
    const parsed = ProgramService.parseProgramsQuery();

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.skip).toBe(0);
    expect(parsed.search).toBe('');
    expect(parsed.filters).toEqual({});
    // Default sort is school asc, with program_name asc tiebreaker.
    expect(parsed.sort).toEqual({ school: 1, program_name: 1 });
  });

  it('computes skip from page/limit and caps limit at MAX_LIMIT (100)', () => {
    const parsed = ProgramService.parseProgramsQuery({
      page: '3',
      limit: '250'
    });

    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(100);
    expect(parsed.skip).toBe(200); // (3 - 1) * 100
  });

  it('falls back to defaults for non-positive page/limit', () => {
    const parsed = ProgramService.parseProgramsQuery({
      page: '0',
      limit: '-5'
    });

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.skip).toBe(0);
  });

  it('normalizes an unknown sortBy to school and honours desc order', () => {
    const parsed = ProgramService.parseProgramsQuery({
      sortBy: 'not_a_field',
      sortOrder: 'DESC'
    });

    expect(parsed.sort).toEqual({ school: -1, program_name: 1 });
  });

  it('does not add a program_name tiebreaker when sorting by program_name', () => {
    const parsed = ProgramService.parseProgramsQuery({
      sortBy: 'program_name',
      sortOrder: 'desc'
    });

    expect(parsed.sort).toEqual({ program_name: -1 });
  });

  it('trims search and collects text + array filters', () => {
    const parsed = ProgramService.parseProgramsQuery({
      search: '  cs  ',
      school: '  MIT ',
      country: 'DE, US ,',
      tags: ['a', '', 'b'],
      lockStatus: 'Locked'
    });

    expect(parsed.search).toBe('cs');
    expect(parsed.filters.school).toBe('MIT');
    expect(parsed.filters.country).toEqual(['DE', 'US']);
    expect(parsed.filters.tags).toEqual(['a', 'b']);
    expect(parsed.filters.lockStatus).toBe('Locked');
  });

  it('ignores an invalid lockStatus value', () => {
    const parsed = ProgramService.parseProgramsQuery({ lockStatus: 'maybe' });

    expect(parsed.filters.lockStatus).toBeUndefined();
  });
});

// ── Real logic + DAO composition: getProgramsPaginated ──────────────────────
describe('ProgramService.getProgramsPaginated (real logic + mocked DAO)', () => {
  it('parses the query, builds the filter, and composes the DAO result', async () => {
    ProgramDAO.findProgramsPaginated.mockResolvedValue([[{ _id: 'p1' }], 7]);

    const result = await ProgramService.getProgramsPaginated({
      page: '2',
      limit: '5',
      search: 'cs',
      school: 'MIT'
    });

    expect(ProgramDAO.findProgramsPaginated).toHaveBeenCalledTimes(1);
    const arg = ProgramDAO.findProgramsPaginated.mock.calls[0][0];

    // Pagination derived from parseProgramsQuery.
    expect(arg.skip).toBe(5); // (2 - 1) * 5
    expect(arg.limit).toBe(5);
    expect(arg.sort).toEqual({ school: 1, program_name: 1 });
    expect(typeof arg.select).toBe('string');
    expect(arg.select).toContain('program_name');

    // Filter always carries the active-program guard.
    expect(arg.filter.$or).toEqual([
      { isArchiv: { $exists: false } },
      { isArchiv: false }
    ]);
    // search + school text filter both become $and regex conditions.
    expect(Array.isArray(arg.filter.$and)).toBe(true);
    const flattened = JSON.stringify(arg.filter.$and);
    expect(flattened).toContain('program_name');
    expect(flattened).toContain('MIT');

    // Composed return value.
    expect(result).toEqual({
      programs: [{ _id: 'p1' }],
      total: 7,
      page: 2,
      limit: 5
    });
  });

  it('omits $and when there is no search or filters', async () => {
    ProgramDAO.findProgramsPaginated.mockResolvedValue([[], 0]);

    const result = await ProgramService.getProgramsPaginated({});

    const arg = ProgramDAO.findProgramsPaginated.mock.calls[0][0];
    expect(arg.filter.$and).toBeUndefined();
    expect(arg.filter.$or).toEqual([
      { isArchiv: { $exists: false } },
      { isArchiv: false }
    ]);
    expect(result).toEqual({ programs: [], total: 0, page: 1, limit: 20 });
  });
});
