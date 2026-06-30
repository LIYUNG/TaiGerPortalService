// CVDraft — the structured contract produced by Stage A (LLM) and consumed by
// the validators and (later) the docxtemplater renderer. The field names map
// 1:1 onto the tags in cv_template.render.docx, so rendering is a pure data fill.
//
// Stage A's only job is to map messy profile + survey inputs into this shape.
// It must NOT invent data: missing info is left empty and surfaced by the
// validators as a checklist item, never fabricated.

export interface CVPersonal {
  fullName: string;
  birthday: string; // DD.MM.YYYY
  birthplace: string;
  nationality: string;
  address: string;
  phone: string;
  email: string;
}

// One education entry. `universities` use major/minor/gpa; `seniorHighSchools`
// and `juniorHighSchools` use gsat/courses. Unused fields stay empty.
export interface CVEducation {
  period: string; // "MM/YYYY - MM/YYYY" (or "MM/YYYY - present")
  institution: string;
  city: string;
  country: string;
  major: string;
  minor: string;
  gpa: string;
  gsat: string;
  courses: string; // comma-separated
  specialActivities: string;
}

export interface CVExperience {
  period: string;
  jobTitle: string;
  company: string;
  city: string;
  country: string;
  bullets: string[];
}

export interface CVAward {
  date: string; // MM/YYYY
  title: string;
  description: string;
}

export interface CVLanguage {
  name: string;
  level: string; // controlled vocabulary, see validate.ts
  testScore: string; // optional, e.g. "105/120"
}

export interface CVComputerSkill {
  name: string;
  level: string; // controlled vocabulary, see validate.ts
}

export interface CVDraft {
  personal: CVPersonal;
  universities: CVEducation[];
  seniorHighSchools: CVEducation[];
  juniorHighSchools: CVEducation[];
  experience: CVExperience[];
  awards: CVAward[];
  languages: CVLanguage[];
  computer: CVComputerSkill[];
  otherSkills: string;
  socialEngagement: string;
  competitiveSports: string;
  hobbies: string;
  anythingElse: string;
}

export type CVChecklistLevel = 'error' | 'warning';

export interface CVChecklistItem {
  section: string;
  level: CVChecklistLevel;
  code: string;
  message: string;
}

export interface CVValidationResult {
  ok: boolean; // true when there are no `error`-level items
  errorCount: number;
  warningCount: number;
  items: CVChecklistItem[];
}

export interface CVDraftResult {
  draft: CVDraft;
  validation: CVValidationResult;
  meta: {
    fileType: string;
    model: string;
    studentId: string;
    programId?: string;
    generatedAt: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDoc = Record<string, any>;

export interface CreateCVDraftParams {
  student: LooseDoc;
  fileType?: string;
  studentId: string;
  programId?: string;
  targetProgram?: string;
  editorRequirements?: string;
}

const emptyPersonal = (): CVPersonal => ({
  fullName: '',
  birthday: '',
  birthplace: '',
  nationality: '',
  address: '',
  phone: '',
  email: ''
});

export const emptyCVDraft = (): CVDraft => ({
  personal: emptyPersonal(),
  universities: [],
  seniorHighSchools: [],
  juniorHighSchools: [],
  experience: [],
  awards: [],
  languages: [],
  computer: [],
  otherSkills: '',
  socialEngagement: '',
  competitiveSports: '',
  hobbies: '',
  anythingElse: ''
});
