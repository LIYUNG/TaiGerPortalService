import SearchDAO from '../dao/search.dao';

// Search results are lean docs decorated with a numeric text-match `score`
// (except name-only student lookups, which have no score and sort to NaN —
// preserving the legacy behaviour). Typed loosely so the comparator can be
// reused across the heterogeneous result arrays.
const byScoreDesc = (a: { score?: number }, b: { score?: number }) =>
  (b.score as number) - (a.score as number);

/**
 * SearchService — orchestrates the search DAO queries (combine + sort by text
 * score). Controller -> service -> dao.
 */
const SearchService = {
  async getPublicResults(q: string) {
    const documentations = await SearchDAO.searchPublicDocumentations(q);
    return documentations.sort(byScoreDesc);
  },

  async getResults(q: string) {
    const [students, documentations, internaldocs, programs] =
      await Promise.all([
        SearchDAO.searchUsers(q),
        SearchDAO.searchDocumentations(q),
        SearchDAO.searchInternaldocs(q),
        SearchDAO.searchPrograms(q)
      ]);

    return students
      .concat(documentations, internaldocs, programs)
      .sort(byScoreDesc);
  },

  async getStudentsResults(q: string) {
    const students = await SearchDAO.searchStudentsByName(q);
    return students.sort(
      byScoreDesc as (
        a: (typeof students)[number],
        b: (typeof students)[number]
      ) => number
    );
  }
};

export = SearchService;
