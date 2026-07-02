// CVDraft validators — the TaiGer template's IMPORTANT-box rules expressed as
// deterministic checks. These never touch an LLM: they surface a checklist the
// editor reviews. `error` = must fix before sending; `warning` = should review.
//
// Design rule: the generator must not fabricate to satisfy these. A flagged gap
// or missing field is the correct, honest outcome — not something to paper over.

import {
  CVDraft,
  CVChecklistItem,
  CVValidationResult,
  CVEducation
} from './types';

const LANGUAGE_LEVELS = [
  'mother tongue',
  'business fluent',
  'fluent',
  'intermediate',
  'beginner'
];
const COMPUTER_LEVELS = ['very good knowledge', 'good knowledge', 'basic knowledge'];

// Matches Chinese / Japanese / fullwidth characters — used for the English-only rule.
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

const ONGOING = ['present', 'current', 'now', 'jetzt', 'till now', 'til now'];

interface Interval {
  start: number; // months since year 0 (year*12 + month)
  end: number;
  label: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

// Parse "MM/YYYY", "YYYY", "Mon YYYY" -> months since year 0; null if unknown.
const parsePoint = (raw: string, nowMonths: number): number | null => {
  const t = (raw || '').trim().toLowerCase();
  if (!t) {
    return null;
  }
  if (ONGOING.some((o) => t.includes(o))) {
    return nowMonths;
  }
  let m = t.match(/(\d{1,2})\s*\/\s*(\d{4})/); // MM/YYYY
  if (m) {
    return parseInt(m[2], 10) * 12 + parseInt(m[1], 10);
  }
  m = t.match(/([a-z]{3})[a-z]*\.?\s*(\d{4})/); // Mon YYYY
  if (m && MONTHS[m[1]]) {
    return parseInt(m[2], 10) * 12 + MONTHS[m[1]];
  }
  m = t.match(/(\d{4})/); // bare year
  if (m) {
    return parseInt(m[1], 10) * 12 + 1;
  }
  return null;
};

const parseInterval = (period: string, nowMonths: number): Interval | null => {
  const parts = (period || '').split(/[–—-]/); // en/em dash or hyphen
  if (parts.length < 2) {
    const single = parsePoint(period, nowMonths);
    return single === null ? null : { start: single, end: single, label: period };
  }
  const start = parsePoint(parts[0], nowMonths);
  const end = parsePoint(parts.slice(1).join('-'), nowMonths);
  if (start === null || end === null) {
    return null;
  }
  return { start, end, label: period };
};

const ym = (months: number): string => {
  const year = Math.floor((months - 1) / 12);
  const month = ((months - 1) % 12) + 1;
  return `${String(month).padStart(2, '0')}/${year}`;
};

const commaCount = (s: string): number =>
  (s || '').split(',').map((x) => x.trim()).filter(Boolean).length;

export const validateCVDraft = (
  draft: CVDraft,
  fileType = 'CV'
): CVValidationResult => {
  const items: CVChecklistItem[] = [];
  const add = (
    section: string,
    level: 'error' | 'warning',
    code: string,
    message: string
  ) => items.push({ section, level, code, message });

  const now = new Date();
  const nowMonths = now.getFullYear() * 12 + (now.getMonth() + 1);

  // --- personal ---
  const p = draft.personal;
  if (!p.fullName) add('personal', 'error', 'missing_name', 'Full name is missing.');
  if (!p.email) add('personal', 'error', 'missing_email', 'Email is missing.');
  (['birthday', 'nationality', 'address', 'phone'] as const).forEach((f) => {
    if (!p[f]) add('personal', 'warning', `missing_${f}`, `Personal field "${f}" is empty.`);
  });

  // --- education presence ---
  if (draft.universities.length === 0) {
    add('education', 'error', 'no_university', 'No university entry. At least one is required.');
  }
  if (draft.seniorHighSchools.length === 0) {
    add('education', 'warning', 'no_senior_high',
      'No senior high school. German universities usually require it.');
  }
  const isBachelor = /bachelor|b\.?(sc|a|eng|ba)\b/i.test(fileType);
  if (isBachelor && draft.juniorHighSchools.length === 0) {
    add('education', 'warning', 'no_junior_high',
      'Bachelor application: junior high school is usually required.');
  }

  // --- per-education checks ---
  const checkEdu = (e: CVEducation, label: string, minCourses: number) => {
    if (!e.period) add('education', 'error', 'edu_no_period', `${label}: missing time period.`);
    if (!e.institution) add('education', 'warning', 'edu_no_institution', `${label}: missing institution name.`);
    if (e.courses && commaCount(e.courses) < minCourses) {
      add('education', 'warning', 'edu_few_courses',
        `${label}: only ${commaCount(e.courses)} course(s); at least ${minCourses} recommended.`);
    }
    if (!e.courses) add('education', 'warning', 'edu_no_courses', `${label}: no courses listed.`);
  };
  draft.universities.forEach((e, i) => {
    checkEdu(e, `University #${i + 1}`, 5);
    if (!e.gpa) add('education', 'warning', 'uni_no_gpa', `University #${i + 1}: GPA missing (include scale, e.g. 3.9/4.30).`);
  });
  draft.seniorHighSchools.forEach((e, i) => checkEdu(e, `Senior high #${i + 1}`, 3));
  draft.juniorHighSchools.forEach((e, i) => checkEdu(e, `Junior high #${i + 1}`, 3));

  // --- experience ---
  draft.experience.forEach((x, i) => {
    const label = `Experience #${i + 1}`;
    if (!x.period) add('experience', 'error', 'exp_no_period', `${label}: missing time period.`);
    if (!x.jobTitle || !x.company) add('experience', 'warning', 'exp_incomplete', `${label}: missing job title or company.`);
    if (x.bullets.length < 3) add('experience', 'warning', 'exp_few_bullets',
      `${label}: only ${x.bullets.length} bullet(s); at least 3 required.`);
  });

  // --- awards ---
  draft.awards.forEach((a, i) => {
    if (!a.title) add('awards', 'warning', 'award_no_title', `Award #${i + 1}: missing title.`);
  });

  // --- skills: controlled vocabulary ---
  if (draft.languages.length === 0) {
    add('skills', 'warning', 'no_languages', 'No languages listed.');
  }
  draft.languages.forEach((l, i) => {
    if (!l.name) return;
    if (!LANGUAGE_LEVELS.includes(l.level.toLowerCase())) {
      add('skills', 'error', 'lang_bad_level',
        `Language "${l.name}": level "${l.level}" not in allowed set (${LANGUAGE_LEVELS.join(', ')}).`);
    }
  });
  draft.computer.forEach((c) => {
    if (!c.name) return;
    if (!COMPUTER_LEVELS.includes(c.level.toLowerCase())) {
      add('skills', 'error', 'computer_bad_level',
        `Computer skill "${c.name}": level "${c.level}" not in allowed set (${COMPUTER_LEVELS.join(', ')}).`);
    }
  });

  // --- hobbies count ---
  if (commaCount(draft.hobbies) < 4) {
    add('hobbies', 'warning', 'few_hobbies',
      `Only ${commaCount(draft.hobbies)} hobby/hobbies; at least 4 recommended.`);
  }

  // --- timeline gaps ---
  const intervals: Interval[] = [
    ...draft.universities,
    ...draft.seniorHighSchools,
    ...draft.juniorHighSchools
  ]
    .map((e) => parseInterval(e.period, nowMonths))
    .concat(draft.experience.map((x) => parseInterval(x.period, nowMonths)))
    .filter((iv): iv is Interval => iv !== null)
    .sort((a, b) => a.start - b.start);

  let coveredUntil = -Infinity;
  intervals.forEach((iv) => {
    if (coveredUntil !== -Infinity && iv.start - coveredUntil > 1) {
      add('timeline', 'warning', 'gap',
        `Possible gap between ${ym(coveredUntil)} and ${ym(iv.start)} — every period must be covered or explained.`);
    }
    coveredUntil = Math.max(coveredUntil, iv.end);
  });

  // --- English-only ---
  const textFields: Array<[string, string]> = [
    ['address', p.address],
    ['otherSkills', draft.otherSkills],
    ['socialEngagement', draft.socialEngagement],
    ['hobbies', draft.hobbies],
    ['anythingElse', draft.anythingElse]
  ];
  draft.universities.forEach((e, i) => textFields.push([`university#${i + 1}.courses`, e.courses]));
  draft.experience.forEach((x, i) => x.bullets.forEach((b, j) => textFields.push([`experience#${i + 1}.bullet${j + 1}`, b])));
  textFields.forEach(([name, val]) => {
    if (val && CJK.test(val)) {
      add('language', 'warning', 'non_english', `Field "${name}" contains non-English text.`);
    }
  });

  const errorCount = items.filter((i) => i.level === 'error').length;
  const warningCount = items.filter((i) => i.level === 'warning').length;
  return { ok: errorCount === 0, errorCount, warningCount, items };
};
