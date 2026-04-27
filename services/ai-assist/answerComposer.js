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
{"links":[{"label":"...","entityType":"student|program","entityId":"...","route":"student_database_profile|student_profile|program_detail","occurrence":1,"leftContext":"...","rightContext":"..."}]}
Rules:
- Add only labels that appear verbatim in answer text.
- Use candidate entityId exactly; never invent IDs.
- Prefer route student_database_profile for "@Name" labels.
- Use student_profile for plain student name labels.
- Use program_detail for program labels.
- occurrence is 1-based index of the matched label in the answer when duplicated.
- leftContext/rightContext are optional short disambiguation anchors from nearby text.
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

const findAllLabelSpans = (answer, label) => {
  if (!answer || !label) {
    return [];
  }

  const spans = [];
  let cursor = 0;

  while (cursor < answer.length) {
    const index = answer.indexOf(label, cursor);
    if (index < 0) {
      break;
    }

    spans.push({
      start: index,
      end: index + label.length
    });
    cursor = index + label.length;
  }

  return spans;
};

const scoreSpanByContext = ({
  answer,
  span,
  leftContext,
  rightContext
}) => {
  let score = 0;

  if (leftContext) {
    const leftWindow = answer.slice(Math.max(0, span.start - 120), span.start);
    if (leftWindow.endsWith(leftContext)) {
      score += 3;
    } else if (leftWindow.includes(leftContext)) {
      score += 1;
    }
  }

  if (rightContext) {
    const rightWindow = answer.slice(span.end, Math.min(answer.length, span.end + 120));
    if (rightWindow.startsWith(rightContext)) {
      score += 3;
    } else if (rightWindow.includes(rightContext)) {
      score += 1;
    }
  }

  return score;
};

const resolveSpanFromLabel = ({
  answer,
  label,
  occurrence,
  leftContext,
  rightContext
}) => {
  const spans = findAllLabelSpans(answer, label);
  if (!spans.length) {
    return null;
  }

  const requestedOccurrence = Number(occurrence);
  if (
    Number.isInteger(requestedOccurrence) &&
    requestedOccurrence > 0 &&
    requestedOccurrence <= spans.length
  ) {
    return spans[requestedOccurrence - 1];
  }

  if (leftContext || rightContext) {
    const ranked = spans
      .map((span) => ({
        span,
        score: scoreSpanByContext({
          answer,
          span,
          leftContext,
          rightContext
        })
      }))
      .sort((left, right) => right.score - left.score);

    if (ranked[0]?.score > 0) {
      return ranked[0].span;
    }
  }

  return spans[0];
};

const normalizeLinkHints = ({ answer, candidates, rawLinks }) => {
  if (!Array.isArray(rawLinks) || !Array.isArray(candidates)) {
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

  return rawLinks
    .map((item) => ({
      label: typeof item?.label === 'string' ? item.label.trim() : '',
      entityType: item?.entityType,
      entityId: typeof item?.entityId === 'string' ? item.entityId.trim() : '',
      route: item?.route,
      start: Number.isInteger(item?.start) ? item.start : null,
      end: Number.isInteger(item?.end) ? item.end : null,
      occurrence: item?.occurrence,
      leftContext:
        typeof item?.leftContext === 'string' ? item.leftContext.trim() : '',
      rightContext:
        typeof item?.rightContext === 'string' ? item.rightContext.trim() : ''
    }))
    .filter((item) => {
      if (!item.label || !item.entityId || !validRoutes.has(item.route)) {
        return false;
      }

      if (!candidateKeySet.has(`${item.entityType}:${item.entityId}`)) {
        return false;
      }

      return answer.includes(item.label);
    })
    .map((item) => {
      const exactSpan =
        Number.isInteger(item?.start) &&
        Number.isInteger(item?.end) &&
        item.start >= 0 &&
        item.end > item.start &&
        item.end <= answer.length &&
        answer.slice(item.start, item.end) === item.label
          ? {
              start: item.start,
              end: item.end
            }
          : null;
      const resolvedSpan =
        exactSpan ||
        resolveSpanFromLabel({
          answer,
          label: item.label,
          occurrence: item.occurrence,
          leftContext: item.leftContext,
          rightContext: item.rightContext
        });

      if (!resolvedSpan) {
        return null;
      }

      return {
        label: item.label,
        entityType: item.entityType,
        entityId: item.entityId,
        route: item.route,
        start: resolvedSpan.start,
        end: resolvedSpan.end
      };
    })
    .filter(Boolean)
    .reduce((unique, item) => {
      const exists = unique.some(
        (known) =>
          known.start === item.start &&
          known.end === item.end &&
          known.entityType === item.entityType &&
          known.entityId === item.entityId &&
          known.route === item.route
      );
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
    return [];
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

    return normalizeLinkHints({
      answer,
      candidates,
      rawLinks: parsed?.links
    });
  } catch (error) {
    return [];
  }
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
  extractAnswerLinkHints
};
