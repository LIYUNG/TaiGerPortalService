// Assembles the raw inputs for Stage A from two homes:
//   1. User profile (reusable facts) -> academic_background + the CV profile
//      blocks (personal_information, professional_experience, awards, skills,
//      interests). Reliable but only as complete as the student's profile.
//   2. The document thread's additional_information -> per-document free-text
//      context (student + editor editable).
// Plus any in-the-moment editor instructions. The CV survey is NOT used.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

export interface CVAggregateInput {
  knownFacts: Loose;
  additionalInformation: string;
  editorRequirements: string;
  targetProgram: string;
}

const s = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim();

// Pull the profile subset that maps onto CV fields. Empty values stay '' so the
// model treats them as unknown (it must never invent missing data).
const extractKnownFacts = (student: Loose): Loose => {
  const ab = student?.academic_background || {};
  const uni = ab.university || {};
  const lang = ab.language || {};

  return {
    fullName: [student.firstname, student.lastname].filter(Boolean).join(' '),
    email: s(student.email),
    birthday: s(student.birthday),
    personal: student.personal_information || {},
    education: {
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
      }
    },
    languageTests: {
      englishCertificate: s(lang.english_certificate),
      englishScore: s(lang.english_score),
      germanCertificate: s(lang.german_certificate),
      germanScore: s(lang.german_score)
    },
    experience: student.professional_experience || [],
    awards: student.awards || [],
    skills: student.skills || {},
    interests: student.interests || {}
  };
};

export const buildCVAggregate = (params: {
  student: Loose;
  additionalInformation?: string;
  editorRequirements?: string;
  targetProgram?: string;
}): CVAggregateInput => ({
  knownFacts: extractKnownFacts(params.student),
  additionalInformation: s(params.additionalInformation),
  editorRequirements: s(params.editorRequirements),
  targetProgram: s(params.targetProgram)
});
