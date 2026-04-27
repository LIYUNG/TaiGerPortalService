const { OpenAiModel, openAIClient } = require('../openai');

const DEFAULT_MODEL = OpenAiModel.GPT_4_o || 'gpt-4o';

const ANSWER_INSTRUCTIONS = `You are TaiGer Portal AI Assist.
Use provided context to answer.
Never answer from memory when portal data is needed.
Never guess student identity.
If multiple students match, ask user to choose.
Only mention data returned by tools.
Be concise and cite which portal section data came from.
Do not expose internal IDs unless needed for disambiguation.`;
const LINK_HINT_INSTRUCTIONS = `Given an answer and candidate entities, return strict JSON only:
{"answer":"... [reflink:1|Some Label] ...","link_hints":{"1":{"entityType":"student|program","entityId":"..."}}}
Rules:
- Keep answer language and meaning.
- Add [reflink:<id>|<label>] markers in answer where inline links should appear.
- Use short numeric refId values: "1", "2", ...
- Use candidate entityId exactly; never invent IDs.
- Return at most 8 link_hints entries.`;

const getResponseText = (response) => {
  if (response?.output_text) {
    return response.output_text;
  }

  const message = (response?.output || []).find((item) => item.type === 'message');
  return (message?.content || [])
    .map((part) => part.text || part.content || '')
    .filter(Boolean)
    .join('\n');
};

const safeEmitToken = async (onToken, token) => {
  if (typeof onToken !== 'function' || !token) {
    return;
  }

  try {
    await onToken(token);
  } catch {
    // Token streaming is best-effort.
  }
};

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

const generateAnswerFromInput = async ({ instructions, input, onToken }) => {
  const requestPayload = {
    model: DEFAULT_MODEL,
    instructions,
    input
  };

  if (
    typeof onToken === 'function' &&
    typeof openAIClient.responses?.stream === 'function'
  ) {
    const stream = await openAIClient.responses.stream(requestPayload);
    let streamedText = '';

    for await (const event of stream) {
      if (
        event?.type === 'response.output_text.delta' &&
        typeof event.delta === 'string' &&
        event.delta
      ) {
        streamedText += event.delta;
        await safeEmitToken(onToken, event.delta);
      }
    }

    const response = await stream.finalResponse();

    return {
      response,
      answer: streamedText || getResponseText(response)
    };
  }

  const response = await openAIClient.responses.create(requestPayload);
  return {
    response,
    answer: getResponseText(response)
  };
};

const normalizeLinkHints = ({ answerWithMarkers, candidates, rawLinkHints }) => {
  if (!rawLinkHints || typeof rawLinkHints !== 'object' || !Array.isArray(candidates)) {
    return {};
  }

  const candidateKeySet = new Set(
    candidates.map((candidate) => `${candidate.entityType}:${candidate.entityId}`)
  );
  const validEntityTypes = new Set(['student', 'program']);

  const markerByRefId = new Map(
    Array.from(
      answerWithMarkers.matchAll(/\[reflink:([a-zA-Z0-9_-]+)\|([^\]]+)\]/g)
    ).map((match) => [String(match[1] || '').trim(), true])
  );

  const normalized = {};
  Object.entries(rawLinkHints).forEach(([refIdRaw, value]) => {
    const refId = String(refIdRaw || '').trim();
    const entityType = String(value?.entityType || '').trim();
    const entityId = String(value?.entityId || '').trim();

    if (!refId || !markerByRefId.has(refId)) {
      return;
    }
    if (!entityId || !validEntityTypes.has(entityType)) {
      return;
    }
    if (!candidateKeySet.has(`${entityType}:${entityId}`)) {
      return;
    }

    normalized[refId] = {
      entityType,
      entityId
    };
  });

  return Object.fromEntries(Object.entries(normalized).slice(0, 8));
};

const extractAnswerLinkHints = async ({ answer, candidates = [] }) => {
  if (
    process.env.NODE_ENV === 'test' ||
    !answer ||
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    !openAIClient.responses?.create
  ) {
    return {
      answer,
      linkHints: {}
    };
  }

  try {
    const response = await openAIClient.responses.create({
      model: DEFAULT_MODEL,
      instructions: LINK_HINT_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: JSON.stringify(
            {
              answer,
              candidates
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

    const answerWithMarkers =
      typeof parsed?.answer === 'string' && parsed.answer.trim()
        ? parsed.answer
        : answer;
    const linkHints = normalizeLinkHints({
      answerWithMarkers,
      candidates,
      rawLinkHints: parsed?.link_hints
    });

    return {
      answer: answerWithMarkers,
      linkHints
    };
  } catch (error) {
    return {
      answer,
      linkHints: {}
    };
  }
};

const extractAnswerReferences = async ({ answer, candidates = [] }) => {
  const result = await extractAnswerLinkHints({
    answer,
    candidates
  });

  if (!result || typeof result !== 'object') {
    return {
      answer,
      linkHints: {}
    };
  }

  return {
    answer: result.answer || answer,
    linkHints:
      result.linkHints && typeof result.linkHints === 'object'
        ? result.linkHints
        : {}
  };
};

const composeAnswer = async ({
  message,
  intentResult,
  conversationContext,
  resolvedStudent,
  toolContext,
  responseLanguageInstruction,
  onToken
}) => {
  if (!openAIClient.responses?.create) {
    return {
      response: undefined,
      answer: ''
    };
  }

  return generateAnswerFromInput({
    onToken,
    instructions: `${ANSWER_INSTRUCTIONS} Follow responseLanguageInstruction exactly.`,
    input: [
      {
        role: 'user',
        content: JSON.stringify(
          {
            currentUserMessage: message,
            responseLanguageInstruction,
            intentResult,
            conversationContext,
            resolvedStudent: resolvedStudent || null,
            toolContext
          },
          null,
          2
        )
      }
    ]
  });
};

module.exports = {
  composeAnswer,
  generateAnswerFromInput,
  extractAnswerLinkHints,
  extractAnswerReferences
};
