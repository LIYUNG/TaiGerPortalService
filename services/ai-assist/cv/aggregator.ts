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

// Pre-generation readiness: which CV sections the student profile can already
// fill, computed from the SAME knownFacts the generator consumes (so the panel
// can never drift from what generation will actually see). Keys line up with the
// AI Draft coverage chips. The passport photo is added by the caller (it lives in
// the profile documents, not in knownFacts).
export const buildCVReadiness = (
  student: Loose
): Array<{ key: string; ok: boolean }> => {
  const kf = extractKnownFacts(student);
  const p = (kf.personal || {}) as Loose;
  const interests = (kf.interests || {}) as Loose;
  const skills = (kf.skills || {}) as Loose;
  const uni = kf.education.university as Loose;
  const hs = kf.education.highSchool as Loose;
  const has = (v: unknown) => Boolean(v && String(v).trim());
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;
  return [
    { key: 'name', ok: has(kf.fullName) },
    {
      key: 'contact',
      ok: has(kf.email) || has(p.phone) || has(p.address)
    },
    {
      key: 'birthNationality',
      ok: has(kf.birthday) || has(p.nationality) || has(p.birthplace)
    },
    { key: 'university', ok: has(uni.name) },
    { key: 'highSchool', ok: has(hs.name) },
    { key: 'experience', ok: arr(kf.experience) },
    { key: 'awards', ok: arr(kf.awards) },
    {
      key: 'languages',
      ok:
        has(kf.languageTests.englishCertificate) ||
        has(kf.languageTests.germanCertificate)
    },
    { key: 'computer', ok: arr(skills.computer) },
    {
      key: 'hobbies',
      ok:
        has(interests.hobbies) ||
        has(interests.social_engagement) ||
        has(interests.competitive_sports)
    }
  ];
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
