// ProgramDAO unit tests — the DAO is a thin query-building layer over the
// Program model, so we mock the model entirely (NO database). These assert that
// each DAO method builds the expected query/options and forwards the model's
// result. Aggregation pipeline internals are NOT validated here (that is the
// integration suite's job); we only assert the pipeline is forwarded and the
// result shaped.
jest.mock('../../models', () => ({
  Program: {
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn()
  }
}));

import { Program } from '../../models';
import ProgramDAO from '../../dao/program.dao';

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (select/sort/skip/limit) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProgramDAO (mocked Program model)', () => {
  it('getProgramByIdLean queries by id and returns the lean doc', async () => {
    const doc = { _id: 'p1', school: 'MIT' };
    Program.findById.mockReturnValue(leanChain(doc));

    const found = await ProgramDAO.getProgramByIdLean('p1');

    expect(Program.findById).toHaveBeenCalledWith('p1');
    expect(found).toBe(doc);
  });

  it('getProgramByIdSelect applies select and returns the lean doc', async () => {
    const doc = { _id: 'p1', school: 'MIT' };
    const chain = leanChain(doc);
    Program.findById.mockReturnValue(chain);

    const found = await ProgramDAO.getProgramByIdSelect('p1', 'school');

    expect(Program.findById).toHaveBeenCalledWith('p1');
    expect(chain.select).toHaveBeenCalledWith('school');
    expect(found).toBe(doc);
  });

  it('createProgram forwards the payload to create', async () => {
    const payload = { school: 'MIT', program_name: 'CS' };
    const created = { _id: 'p2', ...payload };
    Program.create.mockResolvedValue(created);

    const result = await ProgramDAO.createProgram(payload);

    expect(Program.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('updateProgramOne uses findOneAndUpdate with { new: true } and returns the lean doc', async () => {
    const updated = { _id: 'p1', school: 'Renamed' };
    Program.findOneAndUpdate.mockReturnValue(leanChain(updated));

    const result = await ProgramDAO.updateProgramOne(
      { _id: 'p1' },
      { school: 'Renamed' }
    );

    expect(Program.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'p1' },
      { school: 'Renamed' },
      { new: true }
    );
    expect(result).toBe(updated);
  });

  it('updateProgramById uses findByIdAndUpdate with { new: true } and returns the lean doc', async () => {
    const updated = { _id: 'p1', school: 'Renamed' };
    Program.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const result = await ProgramDAO.updateProgramById('p1', {
      school: 'Renamed'
    });

    expect(Program.findByIdAndUpdate).toHaveBeenCalledWith(
      'p1',
      { school: 'Renamed' },
      { new: true }
    );
    expect(result).toBe(updated);
  });

  it('updateManyPrograms forwards filter, update and options', async () => {
    const res = { matchedCount: 3, modifiedCount: 3 };
    Program.updateMany.mockResolvedValue(res);

    const result = await ProgramDAO.updateManyPrograms(
      { isArchiv: false },
      { $set: { degree: 'MSc' } },
      { strict: false }
    );

    expect(Program.updateMany).toHaveBeenCalledWith(
      { isArchiv: false },
      { $set: { degree: 'MSc' } },
      { strict: false }
    );
    expect(result).toBe(res);
  });

  it('updateManyPrograms defaults options to {}', async () => {
    Program.updateMany.mockResolvedValue({});

    await ProgramDAO.updateManyPrograms({ a: 1 }, { $set: { b: 2 } });

    expect(Program.updateMany).toHaveBeenCalledWith(
      { a: 1 },
      { $set: { b: 2 } },
      {}
    );
  });

  it('archiveProgramById sets isArchiv via findByIdAndUpdate', async () => {
    const res = { _id: 'p1' };
    Program.findByIdAndUpdate.mockResolvedValue(res);

    const result = await ProgramDAO.archiveProgramById('p1');

    expect(Program.findByIdAndUpdate).toHaveBeenCalledWith('p1', {
      isArchiv: true
    });
    expect(result).toBe(res);
  });

  it('findPrograms forwards the filter to find().lean()', async () => {
    const docs = [{ _id: 'p1' }];
    Program.find.mockReturnValue(leanChain(docs));

    const result = await ProgramDAO.findPrograms({ school: 'MIT' });

    expect(Program.find).toHaveBeenCalledWith({ school: 'MIT' });
    expect(result).toBe(docs);
  });

  it('findPrograms defaults the filter to {}', async () => {
    Program.find.mockReturnValue(leanChain([]));

    await ProgramDAO.findPrograms();

    expect(Program.find).toHaveBeenCalledWith({});
  });

  it('getDistinctSchoolProgramDegree runs an aggregation and returns its result', async () => {
    const rows = [{ school: 'MIT', program_name: 'CS', degree: 'MSc' }];
    Program.aggregate.mockResolvedValue(rows);

    const result = await ProgramDAO.getDistinctSchoolProgramDegree();

    expect(Program.aggregate).toHaveBeenCalledTimes(1);
    expect(Array.isArray(Program.aggregate.mock.calls[0][0])).toBe(true);
    expect(result).toBe(rows);
  });

  it('findProgramsBySchoolNameDegree forwards the composite filter', async () => {
    const docs = [{ _id: 'p1' }];
    Program.find.mockReturnValue(leanChain(docs));

    const result = await ProgramDAO.findProgramsBySchoolNameDegree({
      school: 'MIT',
      program_name: 'CS',
      degree: 'MSc'
    });

    expect(Program.find).toHaveBeenCalledWith({
      school: 'MIT',
      program_name: 'CS',
      degree: 'MSc'
    });
    expect(result).toBe(docs);
  });

  it('aggregatePrograms forwards the pipeline and returns its result', async () => {
    const pipeline = [{ $match: { isArchiv: false } }];
    const rows = [{ _id: 'p1' }];
    Program.aggregate.mockResolvedValue(rows);

    const result = await ProgramDAO.aggregatePrograms(pipeline);

    expect(Program.aggregate).toHaveBeenCalledWith(pipeline);
    expect(result).toBe(rows);
  });

  it('countPrograms forwards the filter to countDocuments', async () => {
    Program.countDocuments.mockResolvedValue(42);

    const result = await ProgramDAO.countPrograms({ isArchiv: false });

    expect(Program.countDocuments).toHaveBeenCalledWith({ isArchiv: false });
    expect(result).toBe(42);
  });

  it('countPrograms defaults the filter to {}', async () => {
    Program.countDocuments.mockResolvedValue(0);

    await ProgramDAO.countPrograms();

    expect(Program.countDocuments).toHaveBeenCalledWith({});
  });

  it('findProgramsQuery applies select/sort/limit when provided', async () => {
    const docs = [{ _id: 'p1' }];
    const chain = leanChain(docs);
    Program.find.mockReturnValue(chain);

    const result = await ProgramDAO.findProgramsQuery(
      { school: 'MIT' },
      { select: 'school', sort: { school: 1 }, limit: 5 }
    );

    expect(Program.find).toHaveBeenCalledWith({ school: 'MIT' });
    expect(chain.select).toHaveBeenCalledWith('school');
    expect(chain.sort).toHaveBeenCalledWith({ school: 1 });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(result).toBe(docs);
  });

  it('findProgramsQuery skips builder steps when options are omitted', async () => {
    const chain = leanChain([]);
    Program.find.mockReturnValue(chain);

    await ProgramDAO.findProgramsQuery();

    expect(Program.find).toHaveBeenCalledWith({});
    expect(chain.select).not.toHaveBeenCalled();
    expect(chain.sort).not.toHaveBeenCalled();
    expect(chain.limit).not.toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });

  it('findProgramsQuery applies a limit of 0 (limit !== undefined)', async () => {
    const chain = leanChain([]);
    Program.find.mockReturnValue(chain);

    await ProgramDAO.findProgramsQuery({}, { limit: 0 });

    expect(chain.limit).toHaveBeenCalledWith(0);
  });

  it('findProgramsPaginated returns [programs, total] from the page query + count', async () => {
    const programs = [{ _id: 'a' }, { _id: 'b' }];
    const chain = leanChain(programs);
    Program.find.mockReturnValue(chain);
    Program.countDocuments.mockResolvedValue(7);

    const result = await ProgramDAO.findProgramsPaginated({
      filter: { isArchiv: false },
      select: 'school',
      sort: { school: 1 },
      skip: 0,
      limit: 2
    });

    expect(Program.find).toHaveBeenCalledWith({ isArchiv: false });
    expect(chain.select).toHaveBeenCalledWith('school');
    expect(chain.sort).toHaveBeenCalledWith({ school: 1 });
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(2);
    expect(Program.countDocuments).toHaveBeenCalledWith({ isArchiv: false });
    expect(result).toEqual([programs, 7]);
  });
});
