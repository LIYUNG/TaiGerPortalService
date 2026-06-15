// Unit tests for the docs DAOs (Docspage / Documentation / Internaldoc).
// These DAOs are thin query-building layers over their Mongoose models, so we
// mock the models entirely (NO database). Each test asserts the DAO method
// builds the expected query/chain and forwards the model's result. Real query
// behaviour is covered by the integration suite.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn()
  });
  return {
    Docspage: model(),
    Documentation: model(),
    Internaldoc: model()
  };
});

import { Docspage, Documentation, Internaldoc } from '../../models';
import DocspageDAO from '../../dao/docspage.dao';
import DocumentationDAO from '../../dao/documentation.dao';
import InternaldocDAO from '../../dao/internaldoc.dao';

// A query chain that is both chainable (select returns the same chain) and
// thenable, so `await chain` resolves to `value` when the method ends in
// .select() (no trailing .lean()).
const queryChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocspageDAO (mocked models)', () => {
  it('upsertByCategory upserts with { upsert: true, new: true }', async () => {
    const page = { category: 'internal' };
    Docspage.findOneAndUpdate.mockResolvedValue(page);

    const res = await DocspageDAO.upsertByCategory('internal', { author: 'B' });

    expect(Docspage.findOneAndUpdate).toHaveBeenCalledWith(
      { category: 'internal' },
      { author: 'B' },
      { upsert: true, new: true }
    );
    expect(res).toBe(page);
  });

  it('getByCategory finds one by category', async () => {
    const page = { category: 'visa' };
    Docspage.findOne.mockResolvedValue(page);

    const res = await DocspageDAO.getByCategory('visa');

    expect(Docspage.findOne).toHaveBeenCalledWith({ category: 'visa' });
    expect(res).toBe(page);
  });
});

describe('DocumentationDAO (mocked models)', () => {
  it('findAllTitleCategory selects only title + category', async () => {
    const docs = [{ title: 'A', category: 'visa' }];
    Documentation.find.mockReturnValue(queryChain(docs));

    const res = await DocumentationDAO.findAllTitleCategory();

    expect(Documentation.find).toHaveBeenCalledWith();
    const chain = Documentation.find.mock.results[0].value;
    expect(chain.select).toHaveBeenCalledWith('title category');
    expect(res).toBe(docs);
  });

  it('getById finds by id', async () => {
    const doc = { _id: 'd1' };
    Documentation.findById.mockResolvedValue(doc);

    const res = await DocumentationDAO.getById('d1');

    expect(Documentation.findById).toHaveBeenCalledWith('d1');
    expect(res).toBe(doc);
  });

  it('create delegates to Documentation.create', async () => {
    const fields = { title: 'A', category: 'visa' };
    const created = { _id: 'd1', ...fields };
    Documentation.create.mockResolvedValue(created);

    const res = await DocumentationDAO.create(fields);

    expect(Documentation.create).toHaveBeenCalledWith(fields);
    expect(res).toBe(created);
  });

  it('updateById updates with { new: true }', async () => {
    const updated = { _id: 'd1', title: 'B' };
    Documentation.findByIdAndUpdate.mockResolvedValue(updated);

    const res = await DocumentationDAO.updateById('d1', { title: 'B' });

    expect(Documentation.findByIdAndUpdate).toHaveBeenCalledWith(
      'd1',
      { title: 'B' },
      { new: true }
    );
    expect(res).toBe(updated);
  });

  it('deleteById deletes by id', async () => {
    const deleted = { _id: 'd1' };
    Documentation.findByIdAndDelete.mockResolvedValue(deleted);

    const res = await DocumentationDAO.deleteById('d1');

    expect(Documentation.findByIdAndDelete).toHaveBeenCalledWith('d1');
    expect(res).toBe(deleted);
  });
});

describe('InternaldocDAO (mocked models)', () => {
  it('findAllTitleInternalCategory selects title + internal + category', async () => {
    const docs = [{ title: 'Internal note' }];
    Internaldoc.find.mockReturnValue(queryChain(docs));

    const res = await InternaldocDAO.findAllTitleInternalCategory();

    expect(Internaldoc.find).toHaveBeenCalledWith();
    const chain = Internaldoc.find.mock.results[0].value;
    expect(chain.select).toHaveBeenCalledWith('title internal category');
    expect(res).toBe(docs);
  });

  it('getById finds by id', async () => {
    const doc = { _id: 'i1' };
    Internaldoc.findById.mockResolvedValue(doc);

    const res = await InternaldocDAO.getById('i1');

    expect(Internaldoc.findById).toHaveBeenCalledWith('i1');
    expect(res).toBe(doc);
  });

  it('create delegates to Internaldoc.create', async () => {
    const fields = { title: 'Internal note', category: 'ops' };
    const created = { _id: 'i1', ...fields };
    Internaldoc.create.mockResolvedValue(created);

    const res = await InternaldocDAO.create(fields);

    expect(Internaldoc.create).toHaveBeenCalledWith(fields);
    expect(res).toBe(created);
  });

  it('updateById updates with { new: true }', async () => {
    const updated = { _id: 'i1', title: 'B' };
    Internaldoc.findByIdAndUpdate.mockResolvedValue(updated);

    const res = await InternaldocDAO.updateById('i1', { title: 'B' });

    expect(Internaldoc.findByIdAndUpdate).toHaveBeenCalledWith(
      'i1',
      { title: 'B' },
      { new: true }
    );
    expect(res).toBe(updated);
  });

  it('deleteById deletes by id', async () => {
    const deleted = { _id: 'i1' };
    Internaldoc.findByIdAndDelete.mockResolvedValue(deleted);

    const res = await InternaldocDAO.deleteById('i1');

    expect(Internaldoc.findByIdAndDelete).toHaveBeenCalledWith('i1');
    expect(res).toBe(deleted);
  });
});
