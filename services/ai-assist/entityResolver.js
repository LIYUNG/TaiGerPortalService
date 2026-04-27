const {
  searchAccessibleStudents,
  requireAccessibleStudent
} = require('./tools');

const formatStudentName = (student = {}, fallbackDisplayName = null) =>
  [student.firstname, student.lastname].filter(Boolean).join(' ') ||
  fallbackDisplayName ||
  student.email ||
  undefined;

const normalizeResolvedStudent = (student, fallbackDisplayName = null) => ({
  id: student._id?.toString?.() || student.id,
  name: formatStudentName(student, fallbackDisplayName),
  chineseName:
    [student.lastname_chinese, student.firstname_chinese].filter(Boolean).join('') ||
    undefined,
  email: student.email,
  applyingProgramCount: student.applying_program_count
});

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

const resolveStudentById = async (req, studentId, fallbackDisplayName = null) => {
  const normalizedStudentId =
    typeof studentId === 'string' ? studentId.trim() : '';

  if (!normalizedStudentId) {
    return {
      status: 'missing_query',
      candidates: []
    };
  }

  try {
    const student = await requireAccessibleStudent(req, normalizedStudentId);
    return {
      status: 'resolved',
      student: normalizeResolvedStudent(student, fallbackDisplayName),
      candidates: []
    };
  } catch (error) {
    return {
      status: 'not_found',
      candidates: []
    };
  }
};

module.exports = {
  resolveStudent,
  resolveStudentById
};
