// SearchService orchestrates the search DAO queries and applies the real
// service-side logic: combining result sets (getResults) and sorting every
// result set by descending text score. This is a UNIT test: the DAO is mocked
// so no database is touched. We assert both the DAO delegation (right method,
// right args) and the real sort/combine behaviour.
jest.mock('../../dao/search.dao');

import SearchDAO from '../../dao/search.dao';
import SearchService from '../../services/search';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SearchService.getPublicResults (mocked DAO)', () => {
  it('delegates to DAO.searchPublicDocumentations and sorts by descending score', async () => {
    const q = 'visa';
    SearchDAO.searchPublicDocumentations.mockResolvedValue([
      { _id: 'a', score: 1 },
      { _id: 'b', score: 3 },
      { _id: 'c', score: 2 }
    ]);

    const result = await SearchService.getPublicResults(q);

    expect(SearchDAO.searchPublicDocumentations).toHaveBeenCalledTimes(1);
    expect(SearchDAO.searchPublicDocumentations).toHaveBeenCalledWith(q);
    expect(result.map((r) => r._id)).toEqual(['b', 'c', 'a']);
  });
});

describe('SearchService.getResults (mocked DAO)', () => {
  it('queries all four DAO sources, concatenates and sorts by descending score', async () => {
    const q = 'germany';
    SearchDAO.searchUsers.mockResolvedValue([{ _id: 'u', score: 5 }]);
    SearchDAO.searchDocumentations.mockResolvedValue([{ _id: 'd', score: 9 }]);
    SearchDAO.searchInternaldocs.mockResolvedValue([{ _id: 'i', score: 1 }]);
    SearchDAO.searchPrograms.mockResolvedValue([{ _id: 'p', score: 7 }]);

    const result = await SearchService.getResults(q);

    expect(SearchDAO.searchUsers).toHaveBeenCalledTimes(1);
    expect(SearchDAO.searchUsers).toHaveBeenCalledWith(q);
    expect(SearchDAO.searchDocumentations).toHaveBeenCalledTimes(1);
    expect(SearchDAO.searchDocumentations).toHaveBeenCalledWith(q);
    expect(SearchDAO.searchInternaldocs).toHaveBeenCalledTimes(1);
    expect(SearchDAO.searchInternaldocs).toHaveBeenCalledWith(q);
    expect(SearchDAO.searchPrograms).toHaveBeenCalledTimes(1);
    expect(SearchDAO.searchPrograms).toHaveBeenCalledWith(q);

    // users + documentations + internaldocs + programs, sorted by score desc
    expect(result.map((r) => r._id)).toEqual(['d', 'p', 'u', 'i']);
  });
});

describe('SearchService.getStudentsResults (mocked DAO)', () => {
  it('delegates to DAO.searchStudentsByName and sorts by descending score', async () => {
    const q = 'john';
    SearchDAO.searchStudentsByName.mockResolvedValue([
      { _id: 's1', score: 2 },
      { _id: 's2', score: 8 }
    ]);

    const result = await SearchService.getStudentsResults(q);

    expect(SearchDAO.searchStudentsByName).toHaveBeenCalledTimes(1);
    expect(SearchDAO.searchStudentsByName).toHaveBeenCalledWith(q);
    expect(result.map((r) => r._id)).toEqual(['s2', 's1']);
  });
});
