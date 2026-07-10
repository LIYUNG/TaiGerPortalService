import { OpenAiModel, openAIClient } from '../openai';

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
- For student refs, label should be the student display name.
- For program refs, label MUST include both school and program name in one full phrase.
- For program refs, never link only the program name substring.
- For program refs, wrap the entire school+program phrase in ONE reflink marker.
- Prefer program label format: "<School> - <Program Name>".
- Use short numeric refId values: "1", "2", ...
- Use candidate entityId exactly; never invent IDs.
Example:
Input phrase: "Technische Universität München - MSc Data Engineering"
Good: "[reflink:2|Technische Universität München - MSc Data Engineering]"
Bad: "Technische Universität München - [reflink:2|MSc Data Engineering]"`;

// The OpenAI Responses SDK return shape is broad and varies by response kind;
// this helper probes it structurally, so the param is left untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getResponseText = (response: any) => {
  if (response?.output_text) {
    return response.output_text;
  }

  const message = (response?.output || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => item.type === 'message'
  );
  return (
    (message?.content || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((part: any) => part.text || part.content || '')
      .filter(Boolean)
      .join('\n')
  );
};

const safeEmitToken = async (
  onToken: ((token: string) => Promise<void> | void) | undefined,
  token: string
) => {
  if (typeof onToken !== 'function' || !token) {
    return;
  }

  try {
    await onToken(token);
  } catch {
    // Token streaming is best-effort.
  }
};

const safeParseJson = (value: unknown): Record<string, unknown> | null => {
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

const generateAnswerFromInput = async ({
  instructions,
  input,
  onToken
}: {
  instructions: string;
  input: { role: string; content: string }[];
  onToken?: (token: string) => Promise<void> | void;
}) => {
  const requestPayload = {
    model: DEFAULT_MODEL,
    instructions,
    input
  };

  if (
    typeof onToken === 'function' &&
    typeof openAIClient.responses?.stream === 'function'
  ) {
    const stream = await openAIClient.responses.stream(
      requestPayload as Parameters<typeof openAIClient.responses.stream>[0]
    );
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

  const response = await openAIClient.responses.create(
    requestPayload as Parameters<typeof openAIClient.responses.create>[0]
  );
  return {
    response,
    answer: getResponseText(response)
  };
};

interface LinkCandidate {
  entityType: string;
  entityId: string;
  [key: string]: unknown;
}

const normalizeLinkHints = ({
  answerWithMarkers,
  candidates,
  rawLinkHints
}: {
  answerWithMarkers: string;
  candidates: LinkCandidate[];
  rawLinkHints:
    | Record<string, { entityType?: unknown; entityId?: unknown }>
    | undefined;
}): Record<string, { entityType: string; entityId: string }> => {
  if (
    !rawLinkHints ||
    typeof rawLinkHints !== 'object' ||
    !Array.isArray(candidates)
  ) {
    return {};
  }

  const candidateKeySet = new Set(
    candidates.map(
      (candidate) => `${candidate.entityType}:${candidate.entityId}`
    )
  );
  const validEntityTypes = new Set(['student', 'program']);

  const markerByRefId = new Map(
    Array.from(
      answerWithMarkers.matchAll(/\[reflink:([a-zA-Z0-9_-]+)\|([^\]]+)\]/g)
    ).map((match) => [String(match[1] || '').trim(), true])
  );

  const normalized: Record<string, { entityType: string; entityId: string }> =
    {};
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

const extractAnswerLinkHints = async ({
  answer,
  candidates = []
}: {
  answer: string;
  candidates?: LinkCandidate[];
}) => {
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
    // The OpenAI Responses SDK output item union only carries `.content` on
    // message-type items; probed structurally like getResponseText() above.
    const rawText =
      response.output_text ||
      (response.output || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .flatMap((item: any) => item.content || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => item.text || '')
        .join('\n');
    const parsed = safeParseJson(rawText) || extractFirstJsonObject(rawText);

    const answerWithMarkers =
      typeof parsed?.answer === 'string' && parsed.answer.trim()
        ? parsed.answer
        : answer;
    const linkHints = normalizeLinkHints({
      answerWithMarkers,
      candidates,
      rawLinkHints: parsed?.link_hints as
        | Record<string, { entityType?: unknown; entityId?: unknown }>
        | undefined
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

const extractAnswerReferences = async ({
  answer,
  candidates = []
}: {
  answer: string;
  candidates?: LinkCandidate[];
}) => {
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
}: {
  message: string;
  intentResult: unknown;
  conversationContext: unknown;
  resolvedStudent?: unknown;
  toolContext: unknown;
  responseLanguageInstruction: string;
  onToken?: (token: string) => Promise<void> | void;
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

export = {
  composeAnswer,
  generateAnswerFromInput,
  extractAnswerLinkHints,
  extractAnswerReferences
};
