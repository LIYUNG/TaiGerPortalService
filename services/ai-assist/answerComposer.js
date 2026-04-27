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
{"answer":"... [link:1|Some Label] ...","references":[{"refId":"1","label":"Some Label","title":"...","entityType":"student|program","entityId":"...","route":"student_database_profile|student_profile|program_detail"}]}
Rules:
- Keep answer language and meaning.
- Add [link:<id>|<label>] markers in answer where inline links should appear.
- Use short numeric refId values: "1", "2", ...
- Use candidate entityId exactly; never invent IDs.
- Prefer route student_database_profile for "@Name" labels.
- Use student_profile for plain student name labels.
- Use program_detail for program labels.
- Return at most 8 links.`;

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

const normalizeReferences = ({ answerWithMarkers, candidates, rawReferences }) => {
  if (!Array.isArray(rawReferences) || !Array.isArray(candidates)) {
    return [];
  }

  const candidateKeySet = new Set(
    candidates.map((candidate) => `${candidate.entityType}:${candidate.entityId}`)
  );
  const validRoutes = new Set([
    'student_database_profile',
    'student_profile',
    'program_detail'
  ]);

  const markerByRefId = new Map(
    Array.from(
      answerWithMarkers.matchAll(/\[link:([a-zA-Z0-9_-]+)\|([^\]]+)\]/g)
    ).map((match) => [String(match[1] || '').trim(), String(match[2] || '').trim()])
  );

  return rawReferences
    .map((item) => ({
      refId: typeof item?.refId === 'string' ? item.refId.trim() : '',
      label: typeof item?.label === 'string' ? item.label.trim() : '',
      title: typeof item?.title === 'string' ? item.title.trim() : '',
      entityType: item?.entityType,
      entityId: typeof item?.entityId === 'string' ? item.entityId.trim() : '',
      route: item?.route
    }))
    .filter((item) => {
      if (
        !item.refId ||
        !item.label ||
        !item.entityId ||
        !validRoutes.has(item.route)
      ) {
        return false;
      }

      if (!candidateKeySet.has(`${item.entityType}:${item.entityId}`)) {
        return false;
      }

      return markerByRefId.has(item.refId);
    })
    .map((item) => ({
      ...item,
      label: markerByRefId.get(item.refId) || item.label,
      title: item.title || markerByRefId.get(item.refId) || item.label
    }))
    .filter(Boolean)
    .reduce((unique, item) => {
      const exists = unique.some((known) => known.refId === item.refId);
      if (!exists) {
        unique.push(item);
      }
      return unique;
    }, [])
    .slice(0, 8);
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
      references: []
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
    const references = normalizeReferences({
      answerWithMarkers,
      candidates,
      rawReferences: parsed?.references
    });

    return {
      answer: answerWithMarkers,
      references
    };
  } catch (error) {
    return {
      answer,
      references: []
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
      references: []
    };
  }

  return {
    answer: result.answer || answer,
    references: Array.isArray(result.references) ? result.references : []
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
