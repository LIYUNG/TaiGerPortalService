// Coerce the LLM's parsed JSON into a strict CVDraft. The model output is
// untrusted/heterogeneous (missing keys, wrong types, fenced code blocks), so
// we read every field defensively — mirroring services/ai-assist/normalizers.ts.

import {
  CVDraft,
  CVEducation,
  CVExperience,
  CVAward,
  CVLanguage,
  CVComputerSkill,
  emptyCVDraft
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const str = (v: unknown): string => {
  if (v === null || v === undefined) {
    return '';
  }
  if (typeof v === 'string') {
    return v.trim();
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return '';
};

// Accept either an array of strings or a comma/semicolon/newline-joined string.
const strList = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    return v.map(str).filter(Boolean);
  }
  const s = str(v);
  if (!s) {
    return [];
  }
  return s
    .split(/[\n;•]|,(?![^(]*\))/) // split on commas not inside parentheses
    .map((p) => p.trim())
    .filter(Boolean);
};

const asArray = (v: unknown): Loose[] => {
  if (Array.isArray(v)) {
    return v.filter((x) => x && typeof x === 'object');
  }
  if (v && typeof v === 'object') {
    return [v as Loose];
  }
  return [];
};

const education = (raw: Loose): CVEducation => ({
  period: str(raw.period),
  institution: str(raw.institution ?? raw.school ?? raw.name),
  city: str(raw.city),
  country: str(raw.country),
  major: str(raw.major ?? raw.program),
  minor: str(raw.minor),
  gpa: str(raw.gpa),
  gsat: str(raw.gsat),
  courses: Array.isArray(raw.courses) ? strList(raw.courses).join(', ') : str(raw.courses),
  specialActivities: Array.isArray(raw.specialActivities)
    ? strList(raw.specialActivities).join(', ')
    : str(raw.specialActivities)
});

const experience = (raw: Loose): CVExperience => ({
  period: str(raw.period),
  jobTitle: str(raw.jobTitle ?? raw.title),
  company: str(raw.company ?? raw.organization ?? raw.org),
  city: str(raw.city),
  country: str(raw.country),
  bullets: strList(raw.bullets ?? raw.tasks ?? raw.responsibilities)
});

const award = (raw: Loose): CVAward => ({
  date: str(raw.date),
  title: str(raw.title ?? raw.name),
  description: str(raw.description)
});

const language = (raw: Loose): CVLanguage => ({
  name: str(raw.name ?? raw.language),
  level: str(raw.level),
  testScore: str(raw.testScore ?? raw.test_score ?? raw.score)
});

const computerSkill = (raw: Loose): CVComputerSkill => ({
  name: str(raw.name ?? raw.skill),
  level: str(raw.level)
});

// Strip a ```json ... ``` fence if the model wrapped its output in one.
const stripFence = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
};

export const parseCVDraftJson = (text: string): Loose => {
  const cleaned = stripFence(text || '');
  // Fall back to the first {...} block if there is leading/trailing prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice);
};

export const normalizeCVDraft = (raw: Loose | null | undefined): CVDraft => {
  const base = emptyCVDraft();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const personal = (raw.personal ?? {}) as Loose;
  const skills = (raw.skills ?? raw) as Loose;

  return {
    personal: {
      fullName: str(personal.fullName ?? personal.name),
      birthday: str(personal.birthday),
      birthplace: str(personal.birthplace ?? personal.placeOfBirth),
      nationality: str(personal.nationality),
      address: str(personal.address),
      phone: str(personal.phone),
      email: str(personal.email)
    },
    universities: asArray(raw.universities).map(education),
    seniorHighSchools: asArray(raw.seniorHighSchools ?? raw.seniorHigh).map(
      education
    ),
    juniorHighSchools: asArray(raw.juniorHighSchools ?? raw.juniorHigh).map(
      education
    ),
    experience: asArray(raw.experience).map(experience),
    awards: asArray(raw.awards).map(award),
    languages: asArray(skills.languages ?? raw.languages).map(language),
    computer: asArray(skills.computer ?? raw.computer).map(computerSkill),
    otherSkills: Array.isArray(skills.other ?? raw.otherSkills)
      ? strList(skills.other ?? raw.otherSkills).join(', ')
      : str(skills.other ?? raw.otherSkills),
    socialEngagement: str(raw.socialEngagement),
    competitiveSports: str(raw.competitiveSports),
    hobbies: Array.isArray(raw.hobbies)
      ? strList(raw.hobbies).join(', ')
      : str(raw.hobbies),
    anythingElse: str(raw.anythingElse)
  };
};
