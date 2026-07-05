// Unit tests for the AI-Assist CV draft skill: normalization, the deterministic
// validators (the TaiGer IMPORTANT-box rules), and the createCVDraft pipeline
// with the LLM provider mocked (no network).

import { validateCVDraft } from '../../../services/ai-assist/cv/validate';
import {
  parseCVDraftJson,
  normalizeCVDraft
} from '../../../services/ai-assist/cv/normalize';
import { emptyCVDraft, CVDraft } from '../../../services/ai-assist/cv/types';

// Mocked LLM provider for the pipeline test (no network). `mock`-prefixed name
// is required for jest.mock factory hoisting.
const mockStream = jest.fn();
jest.mock('../../../services/ai-assist/llm', () => ({
  getLlmProvider: () => ({
    name: 'openai',
    defaultModel: 'gpt-5.4-mini',
    stream: mockStream
  }),
  getConfiguredModel: () => 'gpt-5.4-mini',
  getModelLabel: (_p: unknown, m: string) => `openai:${m}`
}));
jest.mock('../../../services/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const SAMPLE: CVDraft = {
  personal: {
    fullName: 'Wei-Ting Chen',
    birthday: '15.03.2001',
    birthplace: 'Taipei',
    nationality: 'Taiwan',
    address: 'Taipei',
    phone: '+886 912345678',
    email: 'weiting@example.com'
  },
  universities: [
    {
      period: '09/2019 – 06/2023',
      institution: 'National Taiwan University',
      city: 'Taipei',
      country: 'Taiwan',
      major: 'Computer Science',
      minor: '',
      gpa: '3.9/4.30',
      gsat: '',
      courses: 'Algorithms, ML, Databases, OS, Distributed Systems',
      specialActivities: 'Hackathon lead'
    }
  ],
  seniorHighSchools: [
    {
      period: '09/2016 – 06/2019',
      institution: 'Jianguo High School',
      city: 'Taipei',
      country: 'Taiwan',
      major: '',
      minor: '',
      gpa: '',
      gsat: '68/75',
      courses: 'Calculus, Physics, Chemistry',
      specialActivities: ''
    }
  ],
  juniorHighSchools: [],
  experience: [
    {
      period: '07/2022 – 09/2022',
      jobTitle: 'SWE Intern',
      company: 'Acme',
      city: 'Hsinchu',
      country: 'Taiwan',
      bullets: ['Built CI pipeline', 'Wrote tests', 'Shipped services']
    }
  ],
  awards: [{ date: '05/2022', title: "Dean's List", description: 'Top 5%.' }],
  languages: [
    { name: 'Chinese', level: 'mother tongue', testScore: '' },
    { name: 'English', level: 'fluent', testScore: '105/120' }
  ],
  computer: [{ name: 'Python', level: 'very good knowledge' }],
  otherSkills: 'LaTeX',
  socialEngagement: 'Volunteer tutoring (2021)',
  competitiveSports: '',
  hobbies: 'reading, hiking, photography, chess',
  anythingElse: ''
};

describe('normalizeCVDraft', () => {
  it('coerces a loose object and fills defaults', () => {
    const d = normalizeCVDraft({
      personal: { name: 'Jane Doe', email: 'j@x.com' },
      universities: [{ school: 'NTU', courses: ['A', 'B'] }]
    });
    expect(d.personal.fullName).toBe('Jane Doe');
    expect(d.universities[0].institution).toBe('NTU');
    expect(d.universities[0].courses).toBe('A, B');
    expect(d.experience).toEqual([]);
  });

  it('parses fenced JSON output', () => {
    const parsed = parseCVDraftJson('```json\n{"personal":{"fullName":"X"}}\n```');
    expect(parsed.personal.fullName).toBe('X');
  });
});

describe('validateCVDraft', () => {
  it('passes a complete draft with no errors', () => {
    const r = validateCVDraft(SAMPLE, 'CV');
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  it('flags missing name/email as errors', () => {
    const r = validateCVDraft(emptyCVDraft(), 'CV');
    expect(r.ok).toBe(false);
    expect(r.items.some((i) => i.code === 'missing_name')).toBe(true);
    expect(r.items.some((i) => i.code === 'no_university')).toBe(true);
  });

  it('keeps no_university an error for a non-bachelor application', () => {
    const r = validateCVDraft(emptyCVDraft(), 'CV', 'Master');
    expect(r.items.find((i) => i.code === 'no_university')?.level).toBe(
      'error'
    );
  });

  it('downgrades no_university to a warning for a bachelor application', () => {
    const r = validateCVDraft(emptyCVDraft(), 'CV', 'Bachelor');
    expect(r.items.find((i) => i.code === 'no_university')?.level).toBe(
      'warning'
    );
  });

  it('rejects an out-of-vocabulary language level', () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE)) as CVDraft;
    bad.languages[1].level = 'very good';
    const r = validateCVDraft(bad, 'CV');
    expect(r.items.some((i) => i.code === 'lang_bad_level')).toBe(true);
  });

  it('detects a timeline gap', () => {
    const gappy = JSON.parse(JSON.stringify(SAMPLE)) as CVDraft;
    gappy.experience[0].period = '07/2024 – 09/2024'; // gap after 06/2023
    const r = validateCVDraft(gappy, 'CV');
    expect(r.items.some((i) => i.code === 'gap')).toBe(true);
  });

  it('warns on too few experience bullets', () => {
    const few = JSON.parse(JSON.stringify(SAMPLE)) as CVDraft;
    few.experience[0].bullets = ['only one'];
    const r = validateCVDraft(few, 'CV');
    expect(r.items.some((i) => i.code === 'exp_few_bullets')).toBe(true);
  });

  it('flags non-English text', () => {
    const cjk = JSON.parse(JSON.stringify(SAMPLE)) as CVDraft;
    cjk.hobbies = '閱讀, 登山, 攝影, 西洋棋';
    const r = validateCVDraft(cjk, 'CV');
    expect(r.items.some((i) => i.code === 'non_english')).toBe(true);
  });
});

describe('createCVDraft pipeline (mocked LLM)', () => {
  it('aggregates, generates and validates', async () => {
    mockStream.mockResolvedValue({
      text: JSON.stringify(SAMPLE),
      toolCalls: [],
      usage: {},
      model: 'gpt-5.4-mini',
      stopReason: 'completed'
    });
    // require after mocks are registered
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createCVDraft } = require('../../../services/ai-assist/cv');

    const result = await createCVDraft({
      student: { firstname: 'Wei-Ting', lastname: 'Chen', email: 'weiting@example.com', academic_background: {} },
      fileType: 'CV',
      studentId: 'abc123'
    });

    expect(result.draft.personal.fullName).toBe('Wei-Ting Chen');
    expect(result.meta.studentId).toBe('abc123');
    expect(result.validation.ok).toBe(true);
  });
});
