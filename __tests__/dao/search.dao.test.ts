// SearchDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose models, so we mock the models entirely (NO database, in-memory or
// otherwise). These assert that each DAO method builds the expected
// query/options, attaches a relevance score, and forwards the model's result.
// Real regex search behaviour is covered by the integration suite
// (__tests__/integration), which runs against in-memory MongoDB on
// happy/unhappy paths only.
//
// Query shape: each method builds `{ $and: [ <term>, ... ], <extra filters> }`
// where every term is `{ $or: [ { field: { $regex } }, ... ] }`. That is: every
// whitespace-separated term must match at least one field (AND across terms, OR
// across fields), so a multi-word query can span several fields.
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

import {
  Documentation as DocumentationModel,
  User as UserModel,
  Internaldoc as InternaldocModel,
  Program as ProgramModel
} from '../../models';
import SearchDAO from '../../dao/search.dao';

// The models are auto-mocked above (every method is a jest.fn()); retype
// them so the mock API (mockReturnValue/…) is visible to the type-checker.
const Documentation = DocumentationModel as unknown as Record<
  string,
  jest.Mock
>;
const User = UserModel as unknown as Record<string, jest.Mock>;
const Internaldoc = InternaldocModel as unknown as Record<string, jest.Mock>;
const Program = ProgramModel as unknown as Record<string, jest.Mock>;

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (limit/select) return the same chain so they compose.
const leanChain = (value: unknown): any => {
  const chain: any = {
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
  it('searchPublicDocumentations builds a per-term regex query excluding portal-instruction and scores hits', async () => {
    const docs = [{ title: 'Visa Guide' }];
    const chain = leanChain(docs);
    Documentation.find.mockReturnValue(chain);

    const result = await SearchDAO.searchPublicDocumentations('visa');

    const filter = Documentation.find.mock.calls[0][0];
    expect(filter.$and).toEqual([
      {
        $or: [
          { title: { $regex: 'visa', $options: 'i' } },
          { text: { $regex: 'visa', $options: 'i' } }
        ]
      }
    ]);
    expect(filter.category).toHaveProperty('$not');
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('title');
    // prefix match -> score 2
    expect(result).toEqual([{ title: 'Visa Guide', score: 2 }]);
  });

  it('searchUsers builds a regex query scoped to the allowed roles and scores hits', async () => {
    const docs = [{ firstname: 'Jane', lastname: 'Doe' }];
    const chain = leanChain(docs);
    User.find.mockReturnValue(chain);

    const result = await SearchDAO.searchUsers('jane');

    const filter = User.find.mock.calls[0][0];
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].$or).toEqual(
      expect.arrayContaining([
        { firstname: { $regex: 'jane', $options: 'i' } },
        { email: { $regex: 'jane', $options: 'i' } }
      ])
    );
    expect(filter.role).toEqual({
      $in: ['Student', 'Guest', 'Agent', 'Editor']
    });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith(
      'firstname lastname firstname_chinese lastname_chinese role'
    );
    // exact match on firstname -> score 3
    expect(result).toEqual([{ firstname: 'Jane', lastname: 'Doe', score: 3 }]);
  });

  it('searchDocumentations builds a per-term regex query and selects the title', async () => {
    const docs = [{ title: 'Essay tips' }];
    const chain = leanChain(docs);
    Documentation.find.mockReturnValue(chain);

    const result = await SearchDAO.searchDocumentations('essay');

    expect(Documentation.find.mock.calls[0][0].$and).toEqual([
      {
        $or: [
          { title: { $regex: 'essay', $options: 'i' } },
          { text: { $regex: 'essay', $options: 'i' } }
        ]
      }
    ]);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('title');
    expect(result).toEqual([{ title: 'Essay tips', score: 2 }]);
  });

  it('searchInternaldocs builds a per-term regex query and selects title/internal', async () => {
    const docs = [{ title: 'Internal policy' }];
    const chain = leanChain(docs);
    Internaldoc.find.mockReturnValue(chain);

    const result = await SearchDAO.searchInternaldocs('policy');

    expect(Internaldoc.find.mock.calls[0][0].$and).toEqual([
      {
        $or: [
          { title: { $regex: 'policy', $options: 'i' } },
          { text: { $regex: 'policy', $options: 'i' } }
        ]
      }
    ]);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith('title internal');
    // substring match (not prefix/exact) -> score 1
    expect(result).toEqual([{ title: 'Internal policy', score: 1 }]);
  });

  it('searchPrograms builds a per-term regex query excluding archived programs and scores hits', async () => {
    const docs = [{ school: 'Master University', program_name: 'CS' }];
    const chain = leanChain(docs);
    Program.find.mockReturnValue(chain);

    const result = await SearchDAO.searchPrograms('master');

    const filter = Program.find.mock.calls[0][0];
    expect(filter.$and).toEqual([
      {
        $or: [
          { school: { $regex: 'master', $options: 'i' } },
          { program_name: { $regex: 'master', $options: 'i' } }
        ]
      }
    ]);
    expect(filter.isArchiv).toEqual({ $ne: true });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.select).toHaveBeenCalledWith(
      'school program_name degree semester'
    );
    expect(result).toEqual([
      { school: 'Master University', program_name: 'CS', score: 2 }
    ]);
  });

  it('matches a multi-word query across different fields (one $and clause per term) and sums per-term scores', async () => {
    const docs = [
      {
        school: 'Technische Universitat Munchen (TUM)',
        program_name: 'Elektrotechnik und Informationstechnik'
      }
    ];
    const chain = leanChain(docs);
    Program.find.mockReturnValue(chain);

    const result = await SearchDAO.searchPrograms('tum elektrotechnik');

    const filter = Program.find.mock.calls[0][0];
    // One $and clause per term; each is an $or across the fields.
    expect(filter.$and).toEqual([
      {
        $or: [
          { school: { $regex: 'tum', $options: 'i' } },
          { program_name: { $regex: 'tum', $options: 'i' } }
        ]
      },
      {
        $or: [
          { school: { $regex: 'elektrotechnik', $options: 'i' } },
          { program_name: { $regex: 'elektrotechnik', $options: 'i' } }
        ]
      }
    ]);
    // "tum" is a substring of school (score 1) + "elektrotechnik" is a prefix of
    // program_name (score 2) = 3.
    expect(result[0].score).toBe(3);
  });

  it('escapes regex metacharacters in each term', async () => {
    const chain = leanChain([]);
    Program.find.mockReturnValue(chain);

    await SearchDAO.searchPrograms('C++');

    const filter = Program.find.mock.calls[0][0];
    expect(filter.$and[0].$or[0].school.$regex).toBe('C\\+\\+');
  });

  it('searchStudentsByName builds a case-insensitive regex query capped at 6', async () => {
    const docs = [{ firstname: 'Jane', role: 'Student' }];
    const chain = leanChain(docs);
    User.find.mockReturnValue(chain);

    const result = await SearchDAO.searchStudentsByName('jan');

    const filter = User.find.mock.calls[0][0];
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].$or).toEqual(
      expect.arrayContaining([
        { firstname: { $regex: 'jan', $options: 'i' } },
        { email: { $regex: 'jan', $options: 'i' } }
      ])
    );
    expect(filter.role).toEqual({ $in: ['Student'] });
    expect(chain.limit).toHaveBeenCalledWith(6);
    expect(chain.select).toHaveBeenCalledWith(
      'firstname lastname firstname_chinese lastname_chinese role email'
    );
    // searchStudentsByName returns the lean result unchanged (no score map)
    expect(result).toBe(docs);
  });
});
