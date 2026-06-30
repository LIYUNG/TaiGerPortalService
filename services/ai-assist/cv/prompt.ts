// Stage A prompt. The system message encodes TaiGer's CV rules (harvested from
// the IMPORTANT boxes of the official CV template) and forces a strict JSON
// output that matches the CVDraft contract. The model rewrites the known facts
// and editor-supplied notes into a professional CV but must never invent missing
// data. (The CV survey is no longer a source.)

import { CVAggregateInput } from './aggregator';

const OUTPUT_SHAPE = `{
  "personal": { "fullName": "", "birthday": "DD.MM.YYYY", "birthplace": "", "nationality": "", "address": "", "phone": "", "email": "" },
  "universities": [ { "period": "MM/YYYY – MM/YYYY", "institution": "", "city": "", "country": "", "major": "", "minor": "", "gpa": "", "courses": "comma-separated", "specialActivities": "" } ],
  "seniorHighSchools": [ { "period": "MM/YYYY – MM/YYYY", "institution": "", "city": "", "country": "", "gsat": "", "courses": "", "specialActivities": "" } ],
  "juniorHighSchools": [ { "period": "MM/YYYY – MM/YYYY", "institution": "", "city": "", "country": "", "courses": "", "specialActivities": "" } ],
  "experience": [ { "period": "MM/YYYY – MM/YYYY", "jobTitle": "", "company": "", "city": "", "country": "", "bullets": ["", "", ""] } ],
  "awards": [ { "date": "MM/YYYY", "title": "", "description": "" } ],
  "languages": [ { "name": "", "level": "", "testScore": "" } ],
  "computer": [ { "name": "", "level": "" } ],
  "otherSkills": "",
  "socialEngagement": "",
  "competitiveSports": "",
  "hobbies": "",
  "anythingElse": ""
}`;

export const cvDraftSystemPrompt = (fileType: string): string =>
  [
    `You are a senior TaiGer CV editor preparing the FIRST DRAFT of a student's ${fileType} for German/European university applications. An experienced human editor will refine your draft afterwards.`,
    '',
    'Your job: turn the structured profile facts and the editor-supplied notes into a clean, professional CV in ENGLISH, returned strictly as JSON.',
    '',
    'ABSOLUTE RULES:',
    '1. NEVER invent facts. If a date, school, score, company, or any detail is missing, leave that field as an empty string (or omit the entry). Do not guess, do not fill placeholders. Missing information will be flagged for the editor — fabrication is the worst failure.',
    '2. Output ENGLISH only. Translate any Chinese input to natural professional English.',
    '3. Rewrite raw notes into concise, professional CV phrasing. For each job/internship write at least 3 achievement-oriented bullet points (action verb + what + result) — but only from facts actually provided.',
    '4. Education: include every university AND senior high school. Include junior high school only when this is a bachelor application and the data exists. Always keep the GPA scale provided (e.g. "3.9/4.30").',
    '5. List at least 5 relevant courses per university and at least 3 per high school when available.',
    '6. Language proficiency MUST use one of: "mother tongue", "business fluent", "fluent", "intermediate", "beginner". Computer/hard-skill level MUST use one of: "very good knowledge", "good knowledge", "basic knowledge".',
    '7. Dates use "MM/YYYY – MM/YYYY"; use "present" for ongoing. Birthday uses "DD.MM.YYYY".',
    '8. Aim for no timeline gaps, but DO NOT invent activities to cover them — leave the timeline as the data shows and let the editor address gaps.',
    '',
    'Return ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape:',
    OUTPUT_SHAPE
  ].join('\n');

export const cvDraftUserPrompt = (input: CVAggregateInput): string =>
  [
    input.targetProgram
      ? `Target program: ${input.targetProgram}`
      : 'Target program: (not specified)',
    '',
    'Known structured facts (from the student profile — reliable but sparse; empty values mean unknown):',
    JSON.stringify(input.knownFacts, null, 2),
    '',
    input.additionalInformation
      ? `Additional information the student/editor added for this document:\n${input.additionalInformation}`
      : 'Additional information for this document: (none)',
    '',
    input.editorRequirements
      ? `Editor-supplied facts and instructions (use these; they are authoritative):\n${input.editorRequirements}`
      : 'Editor-supplied facts and instructions: (none)',
    '',
    'Produce the CVDraft JSON now.'
  ].join('\n');
