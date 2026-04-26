const { searchAccessibleStudents } = require('./tools');

const resolveStudent = async (req, studentQuery) => {
  const query = typeof studentQuery === 'string' ? studentQuery.trim() : '';

  if (!query) {
    return { status: 'missing_query', candidates: [] };
  }

  const result = await searchAccessibleStudents(req, {
    query,
    limit: 10
  });
  const candidates = result.data || [];

  if (candidates.length === 0) {
    return { status: 'not_found', candidates: [], searchResult: result };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates,
      searchResult: result
    };
  }

  return {
    status: 'resolved',
    student: candidates[0],
    searchResult: result
  };
};

module.exports = {
  resolveStudent
};
