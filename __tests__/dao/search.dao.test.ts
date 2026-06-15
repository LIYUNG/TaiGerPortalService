// SearchDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose models, so we mock the models entirely (NO database, in-memory or
// otherwise). These assert that each DAO method builds the expected
// query/options and forwards the model's result. Real text/regex search
// behaviour is covered by the integration suite (__tests__/integration), which
// runs against in-memory MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn()
  });
  return {
    Documentation: model(),
    User: model(),
    Internaldoc: model(),
    Program: model()
  };
});

import { Documentation, User, Internaldoc, Program } from '../../models';
import SearchDAO from '../../dao/search.dao';

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (sort/limit/select) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SearchDAO (mocked models)', () => {
  it('searchPublicDocumentations builds a $text query excluding portal-instruction', async () => {
    const docs = [{ title: 'Doc' }];
    const chain = leanChain(docs);
    Documentation.find.mockReturnValue(chain);

    const result = await SearchDAO.searchPublicDocumentations('visa');

    const filter = Documentation.find.mock.calls[0][0];
    expect(filter.$text).toEqual({ $search: 'visa' });
    expect(filter.category).toHaveProperty('$not');
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('title');
    expect(result).toBe(docs);
  });

  it('searchUsers builds a $text query scoped to the allowed roles', async () => {
    const docs = [{ firstname: 'A' }];
    const chain = leanChain(docs);
    User.find.mockReturnValue(chain);

    const result = await SearchDAO.searchUsers('jane');

    const filter = User.find.mock.calls[0][0];
    expect(filter.$text).toEqual({ $search: 'jane' });
    expect(filter.role).toEqual({
      $in: ['Student', 'Guest', 'Agent', 'Editor']
    });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith(
      'firstname lastname firstname_chinese lastname_chinese role'
    );
    expect(result).toBe(docs);
  });

  it('searchDocumentations builds a $text query and selects the title', async () => {
    const docs = [{ title: 'Doc' }];
    const chain = leanChain(docs);
    Documentation.find.mockReturnValue(chain);

    const result = await SearchDAO.searchDocumentations('essay');

    expect(Documentation.find.mock.calls[0][0].$text).toEqual({
      $search: 'essay'
    });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('title');
    expect(result).toBe(docs);
  });

  it('searchInternaldocs builds a $text query and selects title/internal', async () => {
    const docs = [{ title: 'Internal' }];
    const chain = leanChain(docs);
    Internaldoc.find.mockReturnValue(chain);

    const result = await SearchDAO.searchInternaldocs('policy');

    expect(Internaldoc.find.mock.calls[0][0].$text).toEqual({
      $search: 'policy'
    });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('title internal');
    expect(result).toBe(docs);
  });

  it('searchPrograms builds a $text query excluding archived programs', async () => {
    const docs = [{ school: 'X' }];
    const chain = leanChain(docs);
    Program.find.mockReturnValue(chain);

    const result = await SearchDAO.searchPrograms('master');

    const filter = Program.find.mock.calls[0][0];
    expect(filter.$text).toEqual({ $search: 'master' });
    expect(filter.isArchiv).toEqual({ $ne: true });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith(
      'school program_name degree semester'
    );
    expect(result).toBe(docs);
  });

  it('searchStudentsByName builds a case-insensitive regex query capped at 6', async () => {
    const docs = [{ firstname: 'Jane', role: 'Student' }];
    const chain = leanChain(docs);
    User.find.mockReturnValue(chain);

    const result = await SearchDAO.searchStudentsByName('jan');

    const filter = User.find.mock.calls[0][0];
    expect(filter.$and).toBeDefined();
    expect(filter.$and[0].$or).toEqual(
      expect.arrayContaining([
        { firstname: { $regex: 'jan', $options: 'i' } },
        { email: { $regex: 'jan', $options: 'i' } }
      ])
    );
    expect(filter.$and[1]).toEqual({ role: { $in: ['Student'] } });
    expect(chain.limit).toHaveBeenCalledWith(6);
    expect(chain.select).toHaveBeenCalledWith(
      'firstname lastname firstname_chinese lastname_chinese role email'
    );
    expect(result).toBe(docs);
  });
});
