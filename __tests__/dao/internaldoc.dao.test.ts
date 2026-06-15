// InternaldocDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose model, so we mock the model entirely (NO database). These assert that
// each DAO method builds the expected query/chain and forwards the model's
// result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn()
  });
  return {
    Internaldoc: model()
  };
});

import { Internaldoc } from '../../models';
import InternaldocDAO from '../../dao/internaldoc.dao';

// A query chain that is BOTH chainable AND thenable: builder calls (select/...)
// return the same chain, and awaiting the chain directly (no `.lean()`) resolves
// to `value` via `then`.
const queryChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InternaldocDAO (mocked models)', () => {
  it('findAllTitleInternalCategory selects the projection and returns the docs', async () => {
    const docs = [{ _id: 'i1', title: 'Doc' }];
    const chain = queryChain(docs);
    Internaldoc.find.mockReturnValue(chain);

    const result = await InternaldocDAO.findAllTitleInternalCategory();

    expect(Internaldoc.find).toHaveBeenCalledWith();
    expect(chain.select).toHaveBeenCalledWith('title internal category');
    expect(result).toBe(docs);
  });

  it('getById queries by id and returns the doc', async () => {
    const doc = { _id: 'i2' };
    Internaldoc.findById.mockResolvedValue(doc);

    const result = await InternaldocDAO.getById('i2');

    expect(Internaldoc.findById).toHaveBeenCalledWith('i2');
    expect(result).toBe(doc);
  });

  it('create forwards the fields and returns the created doc', async () => {
    const created = { _id: 'i3' };
    Internaldoc.create.mockResolvedValue(created);

    const fields = { title: 'New' };
    const result = await InternaldocDAO.create(fields);

    expect(Internaldoc.create).toHaveBeenCalledWith(fields);
    expect(result).toBe(created);
  });

  it('updateById updates with { new: true } and returns the doc', async () => {
    const updated = { _id: 'i4' };
    Internaldoc.findByIdAndUpdate.mockResolvedValue(updated);

    const fields = { title: 'Renamed' };
    const result = await InternaldocDAO.updateById('i4', fields);

    expect(Internaldoc.findByIdAndUpdate).toHaveBeenCalledWith('i4', fields, {
      new: true
    });
    expect(result).toBe(updated);
  });

  it('deleteById deletes by id and returns the deleted doc', async () => {
    const deleted = { _id: 'i5' };
    Internaldoc.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await InternaldocDAO.deleteById('i5');

    expect(Internaldoc.findByIdAndDelete).toHaveBeenCalledWith('i5');
    expect(result).toBe(deleted);
  });
});
