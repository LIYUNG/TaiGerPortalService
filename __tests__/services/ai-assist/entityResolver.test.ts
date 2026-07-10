// Unit tests for services/ai-assist/entityResolver. No DB. The tools module
// (searchAccessibleStudents / requireAccessibleStudent) is fully mocked.

jest.mock('../../../services/ai-assist/tools', () => ({
  searchAccessibleStudents: jest.fn(),
  requireAccessibleStudent: jest.fn()
}));

import toolsModule from '../../../services/ai-assist/tools';
import entityResolverModule from '../../../services/ai-assist/entityResolver';

const { searchAccessibleStudents, requireAccessibleStudent } =
  toolsModule as unknown as Record<string, jest.Mock>;
const { resolveStudent, resolveStudentById } =
  entityResolverModule as unknown as {
    resolveStudent: (req: any, query: any) => Promise<any>;
    resolveStudentById: (
      req: any,
      id: any,
      fallbackDisplayName?: string | null
    ) => Promise<any>;
  };

const REQ = { user: { role: 'Admin', _id: 'admin_1' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolveStudent', () => {
  it('returns missing_query when the query is empty/whitespace', async () => {
    const result = await resolveStudent(REQ, '   ');
    expect(result).toEqual({ status: 'missing_query', candidates: [] });
    expect(searchAccessibleStudents).not.toHaveBeenCalled();
  });

  it('returns missing_query when the query is not a string', async () => {
    const result = await resolveStudent(REQ, null);
    expect(result.status).toBe('missing_query');
  });

  it('returns not_found when the search yields no candidates', async () => {
    searchAccessibleStudents.mockResolvedValue({ data: [] });
    const result = await resolveStudent(REQ, 'Ada');
    expect(result).toEqual({
      status: 'not_found',
      candidates: [],
      searchResult: { data: [] }
    });
  });

  it('returns not_found when result.data is missing entirely', async () => {
    searchAccessibleStudents.mockResolvedValue({});
    const result = await resolveStudent(REQ, 'Ada');
    expect(result.status).toBe('not_found');
  });

  it('returns ambiguous with all candidates when more than one matches', async () => {
    const candidates = [{ id: 's1' }, { id: 's2' }];
    searchAccessibleStudents.mockResolvedValue({ data: candidates });
    const result = await resolveStudent(REQ, 'Smith');
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toBe(candidates);
    expect(result.searchResult).toEqual({ data: candidates });
  });

  it('resolves to the single candidate when exactly one matches', async () => {
    const candidate = { id: 's1', name: 'Ada' };
    searchAccessibleStudents.mockResolvedValue({ data: [candidate] });
    const result = await resolveStudent(REQ, 'Ada');
    expect(result.status).toBe('resolved');
    expect(result.student).toBe(candidate);
  });

  it('trims the query before searching', async () => {
    searchAccessibleStudents.mockResolvedValue({ data: [{ id: 's1' }] });
    await resolveStudent(REQ, '  Ada  ');
    expect(searchAccessibleStudents).toHaveBeenCalledWith(REQ, {
      query: 'Ada',
      limit: 10
    });
  });
});

describe('resolveStudentById', () => {
  it('returns missing_query for an empty id', async () => {
    const result = await resolveStudentById(REQ, '   ');
    expect(result).toEqual({ status: 'missing_query', candidates: [] });
    expect(requireAccessibleStudent).not.toHaveBeenCalled();
  });

  it('returns missing_query for a non-string id', async () => {
    const result = await resolveStudentById(REQ, 12345);
    expect(result.status).toBe('missing_query');
  });

  it('resolves and normalizes an accessible student (full name from first/last)', async () => {
    requireAccessibleStudent.mockResolvedValue({
      _id: { toString: () => 'student_99' },
      firstname: 'Ada',
      lastname: 'Lovelace',
      firstname_chinese: '達',
      lastname_chinese: '愛',
      email: 'ada@example.com',
      applying_program_count: 3
    });
    const result = await resolveStudentById(REQ, '  student_99  ');
    expect(requireAccessibleStudent).toHaveBeenCalledWith(REQ, 'student_99');
    expect(result).toEqual({
      status: 'resolved',
      student: {
        id: 'student_99',
        name: 'Ada Lovelace',
        chineseName: '愛達',
        email: 'ada@example.com',
        applyingProgramCount: 3
      },
      candidates: []
    });
  });

  it('falls back to the provided display name when no first/last name exists', async () => {
    requireAccessibleStudent.mockResolvedValue({
      id: 'student_2',
      email: 'x@example.com'
    });
    const result = await resolveStudentById(REQ, 'student_2', 'Bound Name');
    expect(result.student.name).toBe('Bound Name');
    expect(result.student.id).toBe('student_2');
    expect(result.student.chineseName).toBeUndefined();
  });

  it('falls back to email when neither name nor display name is present', async () => {
    requireAccessibleStudent.mockResolvedValue({
      id: 'student_3',
      email: 'only-email@example.com'
    });
    const result = await resolveStudentById(REQ, 'student_3');
    expect(result.student.name).toBe('only-email@example.com');
  });

  it('returns not_found when the student is inaccessible (requireAccessibleStudent throws)', async () => {
    requireAccessibleStudent.mockRejectedValue(new Error('Student not found'));
    const result = await resolveStudentById(REQ, 'nope');
    expect(result).toEqual({ status: 'not_found', candidates: [] });
  });
});
