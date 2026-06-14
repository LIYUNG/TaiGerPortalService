import SearchDAO from '../dao/search.dao';

const byScoreDesc = (a, b) => b.score - a.score;

/**
 * SearchService — orchestrates the search DAO queries (combine + sort by text
 * score). Controller -> service -> dao.
 */
const SearchService = {
  async getPublicResults(q) {
    const documentations = await SearchDAO.searchPublicDocumentations(q);
    return documentations.sort(byScoreDesc);
  },

  async getResults(q) {
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

  async getStudentsResults(q) {
    const students = await SearchDAO.searchStudentsByName(q);
    return students.sort(byScoreDesc);
  }
};

export = SearchService;
