import type { Request } from 'express';

import tools from './tools';

// `tools` is a CommonJS (`export =`) module; under isolatedModules it must be
// imported as a default and destructured here rather than via a named import.
const { searchAccessibleStudents, requireAccessibleStudent } = tools;

// Mongoose lean student documents (union of FlattenMaps shapes) are probed
// structurally here, so the param is left untyped.
const formatStudentName = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  student: any = {},
  fallbackDisplayName: string | null = null
) =>
  [student.firstname, student.lastname].filter(Boolean).join(' ') ||
  fallbackDisplayName ||
  student.email ||
  undefined;

const normalizeResolvedStudent = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  student: any,
  fallbackDisplayName: string | null = null
) => ({
  id: student._id?.toString?.() || student.id,
  name: formatStudentName(student, fallbackDisplayName),
  chineseName:
    [student.lastname_chinese, student.firstname_chinese]
      .filter(Boolean)
      .join('') || undefined,
  email: student.email,
  applyingProgramCount: student.applying_program_count
});

const resolveStudent = async (req: Request, studentQuery: string) => {
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

const resolveStudentById = async (
  req: Request,
  studentId: string,
  fallbackDisplayName: string | null = null
) => {
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

export = {
  resolveStudent,
  resolveStudentById
};
