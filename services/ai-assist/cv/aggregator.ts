// Assembles the raw inputs for Stage A from the student profile only:
//   structured profile -> student.academic_background (reliable but sparse)
// plus any editor-supplied facts (the notes box) passed as editorRequirements.
// The CV survey is intentionally NOT used. Output is loose: a `knownFacts`
// object the model merges into the strict CVDraft.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

export interface CVAggregateInput {
  knownFacts: Loose;
  editorRequirements: string;
  targetProgram: string;
}

const s = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim();

// Pull the subset of academic_background that maps onto CV fields. Everything
// is optional; empty values are kept as '' so the model treats them as unknown.
const extractKnownFacts = (student: Loose): Loose => {
  const ab = student?.academic_background || {};
  const uni = ab.university || {};
  const lang = ab.language || {};

  return {
    fullName: [student.firstname, student.lastname].filter(Boolean).join(' '),
    email: s(student.email),
    university: {
      name: s(uni.attended_university),
      program: s(uni.attended_university_program),
      isGraduated: s(uni.isGraduated),
      expectedGradDate: s(uni.expected_grad_date),
      gpa: s(uni.My_GPA_Uni),
      gpaScale: s(uni.Highest_GPA_Uni),
      hasExchange: s(uni.Has_Exchange_Experience),
      hasInternship: s(uni.Has_Internship_Experience),
      hasWorking: s(uni.Has_Working_Experience)
    },
    secondDegree: {
      university: s(uni.attendedSecondDegreeUniversity),
      program: s(uni.attendedSecondDegreeProgram),
      gpa: s(uni.mySecondDegreeGPA),
      expectedGradDate: s(uni.expectedSecondDegreeGradDate)
    },
    highSchool: {
      name: s(uni.attended_high_school),
      graduatedYear: s(uni.high_school_graduated_year)
    },
    languages: {
      englishCertificate: s(lang.english_certificate),
      englishScore: s(lang.english_score),
      germanCertificate: s(lang.german_certificate),
      germanScore: s(lang.german_score)
    }
  };
};

export const buildCVAggregate = (params: {
  student: Loose;
  editorRequirements?: string;
  targetProgram?: string;
}): CVAggregateInput => ({
  knownFacts: extractKnownFacts(params.student),
  editorRequirements: s(params.editorRequirements),
  targetProgram: s(params.targetProgram)
});
