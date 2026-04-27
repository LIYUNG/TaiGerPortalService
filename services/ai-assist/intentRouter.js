const { OpenAiModel, openAIClient } = require('../openai');

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';

const INTENTS = Object.freeze([
  'student_lookup',
  'student_applications',
  'student_communications',
  'admissions_overview',
  'support_tickets',
  'student_documents',
  'general'
]);

const INTENT_CLASSIFIER_INSTRUCTIONS =
  'Classify user request into one intent. Return strict JSON only with keys: intent, studentQuery, needsStudentResolution. intent must be one of: student_lookup, student_applications, student_communications, admissions_overview, support_tickets, student_documents, general. studentQuery should be null when not needed.';

const safeParseJson = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const extractFirstJsonObject = (value = '') => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return null;
  }

  return safeParseJson(value.slice(start, end + 1));
};

const normalizeIntentResult = (result = {}, message = '') => {
  const normalizedIntent = INTENTS.includes(result.intent)
    ? result.intent
    : 'general';
  const studentQuery =
    typeof result.studentQuery === 'string' && result.studentQuery.trim()
      ? result.studentQuery.trim()
      : null;
  const needsStudentResolution =
    typeof result.needsStudentResolution === 'boolean'
      ? result.needsStudentResolution
      : Boolean(studentQuery);

  if (normalizedIntent !== 'general') {
    return {
      intent: normalizedIntent,
      studentQuery,
      needsStudentResolution: true
    };
  }

  const looksLikeStudentQuestion =
    /\b(student|application|admission|message|communication|document|ticket)\b/i.test(
      message
    );

  return {
    intent: 'general',
    studentQuery,
    needsStudentResolution: needsStudentResolution && looksLikeStudentQuestion
  };
};

const classifyIntentHeuristically = (message = '') => {
  const text = String(message || '').trim();
  const normalized = text.toLowerCase();

  const extractStudentQuery = () => {
    const findMatch = text.match(
      /\b(?:find|show|what is|what's|summarize|review|status of|for)\s+([a-z0-9@._\-\s\u4e00-\u9fff]+)/i
    );

    if (findMatch?.[1]) {
      return findMatch[1].trim();
    }

    const stripped = text
      .replace(
        /\b(latest|recent|messages?|communications?|emails?|application|applications|status|documents?|support|tickets?)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

    if (stripped) {
      return stripped;
    }

    return null;
  };

  if (/\b(application|admission|enrol|enroll|offer)\b/i.test(normalized)) {
    return {
      intent: 'student_applications',
      studentQuery: extractStudentQuery(),
      needsStudentResolution: true
    };
  }

  if (
    /\b(message|messages|communication|communications|email|emails|chat|conversation|conversations)\b/i.test(
      normalized
    )
  ) {
    return {
      intent: 'student_communications',
      studentQuery: extractStudentQuery(),
      needsStudentResolution: true
    };
  }

  if (/\b(document|profile|transcript|cv|resume)\b/i.test(normalized)) {
    return {
      intent: 'student_documents',
      studentQuery: extractStudentQuery(),
      needsStudentResolution: true
    };
  }

  if (/\b(ticket|support|complaint)\b/i.test(normalized)) {
    return {
      intent: 'support_tickets',
      studentQuery: extractStudentQuery(),
      needsStudentResolution: true
    };
  }

  if (/\b(find|lookup|search|student)\b/i.test(normalized)) {
    return {
      intent: 'student_lookup',
      studentQuery: extractStudentQuery() || text.replace(/^@/, '').trim(),
      needsStudentResolution: true
    };
  }

  return {
    intent: 'general',
    studentQuery: null,
    needsStudentResolution: false
  };
};

const classifyIntent = async ({ message, conversationContext }) => {
  if (!openAIClient.responses?.create) {
    return {
      intent: 'general',
      studentQuery: null,
      needsStudentResolution: false
    };
  }

  const response = await openAIClient.responses.create({
    model: DEFAULT_MODEL,
    instructions: INTENT_CLASSIFIER_INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: JSON.stringify(
          {
            message,
            conversationContext
          },
          null,
          2
        )
      }
    ]
  });

  const rawText =
    response.output_text ||
    (response.output || [])
      .flatMap((item) => item.content || [])
      .map((item) => item.text || '')
      .join('\n');

  const parsed = safeParseJson(rawText) || extractFirstJsonObject(rawText);

  if (!parsed) {
    return classifyIntentHeuristically(message);
  }

  return normalizeIntentResult(parsed, message);
};

module.exports = {
  INTENTS,
  classifyIntent
};
