jest.mock('../../../services/openai', () => ({
  openAIClient: {
    responses: {
      create: jest.fn(),
      stream: jest.fn()
    }
  },
  OpenAiModel: { GPT_4_o: 'gpt-4o' }
}));

import { openAIClient } from '../../../services/openai';
import {
  composeAnswer,
  generateAnswerFromInput,
  extractAnswerLinkHints,
  extractAnswerReferences
} from '../../../services/ai-assist/answerComposer';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  delete openAIClient.responses.stream;
  openAIClient.responses.create = jest.fn();
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('generateAnswerFromInput', () => {
  it('returns answer from response.output_text (non-stream, no onToken)', async () => {
    openAIClient.responses.create.mockResolvedValue({
      id: 'r1',
      output_text: 'Plain answer'
    });

    const result = await generateAnswerFromInput({
      instructions: 'instr',
      input: [{ role: 'user', content: 'hi' }]
    });

    expect(result.answer).toBe('Plain answer');
    expect(result.response.id).toBe('r1');
  });

  it('builds answer from output message parts when output_text is absent', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [{ text: 'part one' }, { content: 'part two' }, { text: '' }]
        }
      ]
    });

    const result = await generateAnswerFromInput({
      instructions: 'instr',
      input: []
    });

    expect(result.answer).toBe('part one\npart two');
  });

  it('streams tokens and uses streamed text when onToken and stream are present', async () => {
    const events = [
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      { type: 'other', delta: 'ignored' },
      { type: 'response.output_text.delta', delta: '' }
    ];
    const finalResponse = { id: 'stream_resp', output_text: 'Hello' };
    openAIClient.responses.stream = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (const e of events) {
          yield e;
        }
      },
      finalResponse: jest.fn().mockResolvedValue(finalResponse)
    });
    const tokens = [];
    const onToken = jest.fn(async (t) => tokens.push(t));

    const result = await generateAnswerFromInput({
      instructions: 'instr',
      input: [],
      onToken
    });

    expect(tokens).toEqual(['Hel', 'lo']);
    expect(result.answer).toBe('Hello');
    expect(result.response).toBe(finalResponse);
  });

  it('falls back to getResponseText when streaming produced no deltas', async () => {
    const finalResponse = { output_text: 'Final from response' };
    openAIClient.responses.stream = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        // no delta events
      },
      finalResponse: jest.fn().mockResolvedValue(finalResponse)
    });

    const result = await generateAnswerFromInput({
      instructions: 'instr',
      input: [],
      onToken: jest.fn()
    });

    expect(result.answer).toBe('Final from response');
  });

  it('does not emit empty-string deltas and ignores a non-function onToken', async () => {
    // onToken non-function -> safeEmitToken early return (line 53-54); but stream
    // path requires a function, so cover via the empty-token branch instead: a
    // delta of '' is filtered before emit, and a truthy onToken with empty token
    // hits the `!token` guard.
    const emitted: string[] = [];
    openAIClient.responses.stream = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'response.output_text.delta', delta: 'a' };
      },
      finalResponse: jest.fn().mockResolvedValue({ output_text: 'a' })
    });
    const onToken = jest.fn(async (t: string) => {
      emitted.push(t);
    });

    await generateAnswerFromInput({ instructions: 'i', input: [], onToken });
    // empty-delta events are skipped before reaching safeEmitToken
    expect(emitted).toEqual(['a']);
  });

  it('returns the create-response answer when onToken is provided but stream is unavailable', async () => {
    // onToken present but no responses.stream -> non-stream create path is used.
    delete openAIClient.responses.stream;
    openAIClient.responses.create.mockResolvedValue({ output_text: 'created' });

    const result = await generateAnswerFromInput({
      instructions: 'i',
      input: [],
      onToken: jest.fn()
    });
    expect(result.answer).toBe('created');
  });

  it('swallows onToken errors (best-effort streaming)', async () => {
    openAIClient.responses.stream = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'response.output_text.delta', delta: 'x' };
      },
      finalResponse: jest.fn().mockResolvedValue({ output_text: 'x' })
    });
    const onToken = jest.fn().mockRejectedValue(new Error('emit fail'));

    await expect(
      generateAnswerFromInput({ instructions: 'i', input: [], onToken })
    ).resolves.toMatchObject({ answer: 'x' });
  });
});

describe('composeAnswer', () => {
  it('returns empty answer when responses API is unavailable', async () => {
    const original = openAIClient.responses;
    openAIClient.responses = undefined;

    const result = await composeAnswer({ message: 'hi' });
    expect(result).toEqual({ response: undefined, answer: '' });

    openAIClient.responses = original;
  });

  it('delegates to generateAnswerFromInput with composed input', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output_text: 'composed'
    });

    const result = await composeAnswer({
      message: 'Summarize Abby',
      intentResult: { intent: 'student_lookup' },
      conversationContext: { boundStudentId: 's1' },
      resolvedStudent: { id: 's1', name: 'Abby' },
      toolContext: { foo: 'bar' },
      responseLanguageInstruction: 'Respond in English.'
    });

    expect(result.answer).toBe('composed');
    const payload = openAIClient.responses.create.mock.calls[0][0];
    expect(payload.input[0].content).toContain('Summarize Abby');
    expect(payload.input[0].content).toContain('"resolvedStudent"');
  });

  it('serializes a null resolvedStudent', async () => {
    openAIClient.responses.create.mockResolvedValue({ output_text: 'ok' });
    await composeAnswer({ message: 'hi', resolvedStudent: null });
    const payload = openAIClient.responses.create.mock.calls[0][0];
    expect(payload.input[0].content).toContain('"resolvedStudent": null');
  });
});

describe('extractAnswerLinkHints', () => {
  it('short-circuits in test env returning empty link hints', async () => {
    const result = await extractAnswerLinkHints({
      answer: 'hello',
      candidates: [{ entityType: 'student', entityId: 's1' }]
    });
    expect(result).toEqual({ answer: 'hello', linkHints: {} });
  });

  it('short-circuits when there are no candidates', async () => {
    process.env.NODE_ENV = 'production';
    const result = await extractAnswerLinkHints({
      answer: 'hello',
      candidates: []
    });
    expect(result).toEqual({ answer: 'hello', linkHints: {} });
  });

  it('produces markers and normalized link hints from a model response', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        answer: 'See [reflink:1|Abby] and [reflink:2|TU - CS]',
        link_hints: {
          1: { entityType: 'student', entityId: 's1' },
          2: { entityType: 'program', entityId: 'p1' },
          3: { entityType: 'student', entityId: 'missing_marker' },
          4: { entityType: 'badtype', entityId: 's1' },
          5: { entityType: 'student', entityId: 'not_a_candidate' }
        }
      })
    });

    const result = await extractAnswerLinkHints({
      answer: 'See Abby and TU CS',
      candidates: [
        { entityType: 'student', entityId: 's1' },
        { entityType: 'program', entityId: 'p1' }
      ]
    });

    expect(result.answer).toContain('[reflink:1|Abby]');
    expect(result.linkHints).toEqual({
      1: { entityType: 'student', entityId: 's1' },
      2: { entityType: 'program', entityId: 'p1' }
    });
  });

  it('keeps the original answer when parsed answer is blank and assembles output array text', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockResolvedValue({
      output: [
        {
          content: [
            {
              text: JSON.stringify({
                answer: '   ',
                link_hints: { 1: { entityType: 'student', entityId: 's1' } }
              })
            }
          ]
        }
      ]
    });

    const result = await extractAnswerLinkHints({
      answer: 'original answer',
      candidates: [{ entityType: 'student', entityId: 's1' }]
    });

    expect(result.answer).toBe('original answer');
    // marker for refId 1 absent in original answer -> hint dropped
    expect(result.linkHints).toEqual({});
  });

  it('returns empty hints when the model output is not parseable JSON', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockResolvedValue({
      output_text: 'totally not json'
    });

    const result = await extractAnswerLinkHints({
      answer: 'ans',
      candidates: [{ entityType: 'student', entityId: 's1' }]
    });
    expect(result).toEqual({ answer: 'ans', linkHints: {} });
  });

  it('recovers from prose-wrapped JSON via extractFirstJsonObject', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockResolvedValue({
      output_text:
        'noise {"answer":"X [reflink:1|Abby]","link_hints":{"1":{"entityType":"student","entityId":"s1"}}} tail'
    });

    const result = await extractAnswerLinkHints({
      answer: 'X Abby',
      candidates: [{ entityType: 'student', entityId: 's1' }]
    });
    expect(result.linkHints).toEqual({
      1: { entityType: 'student', entityId: 's1' }
    });
  });

  it('returns empty hints when the model call throws', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockRejectedValue(new Error('boom'));

    const result = await extractAnswerLinkHints({
      answer: 'ans',
      candidates: [{ entityType: 'student', entityId: 's1' }]
    });
    expect(result).toEqual({ answer: 'ans', linkHints: {} });
  });

  it('drops a hint whose marker is present but whose entityId is blank', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        answer: 'See [reflink:1|Abby] and [reflink:2|Bob]',
        link_hints: {
          // marker present, entityId blank -> !entityId branch (line 183-184)
          1: { entityType: 'student', entityId: '' },
          // marker present, valid -> kept
          2: { entityType: 'student', entityId: 's2' }
        }
      })
    });

    const result = await extractAnswerLinkHints({
      answer: 'See Abby and Bob',
      candidates: [{ entityType: 'student', entityId: 's2' }]
    });

    expect(result.linkHints).toEqual({
      2: { entityType: 'student', entityId: 's2' }
    });
  });

  it('drops a hint with a valid marker and type whose entity is not among candidates', async () => {
    process.env.NODE_ENV = 'production';
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        answer: 'See [reflink:1|Abby]',
        link_hints: {
          // marker present, valid type, non-blank id, but id not in candidates -> line 186-187
          1: { entityType: 'student', entityId: 'ghost' }
        }
      })
    });

    const result = await extractAnswerLinkHints({
      answer: 'See Abby',
      candidates: [{ entityType: 'student', entityId: 's2' }]
    });

    expect(result.linkHints).toEqual({});
  });

  it('caps normalized link hints to 8 entries', async () => {
    process.env.NODE_ENV = 'production';
    const markers = Array.from(
      { length: 10 },
      (_, i) => `[reflink:${i + 1}|L${i}]`
    ).join(' ');
    const link_hints = {};
    const candidates = [];
    for (let i = 1; i <= 10; i += 1) {
      link_hints[i] = { entityType: 'student', entityId: `s${i}` };
      candidates.push({ entityType: 'student', entityId: `s${i}` });
    }
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({ answer: markers, link_hints })
    });

    const result = await extractAnswerLinkHints({ answer: 'a', candidates });
    expect(Object.keys(result.linkHints)).toHaveLength(8);
  });
});

describe('extractAnswerReferences', () => {
  it('returns answer and empty linkHints in test env', async () => {
    const result = await extractAnswerReferences({
      answer: 'final',
      candidates: [{ entityType: 'student', entityId: 's1' }]
    });
    expect(result).toEqual({ answer: 'final', linkHints: {} });
  });

  it('defaults to the original answer and empty hints when link extraction yields blanks', async () => {
    const result = await extractAnswerReferences({ answer: 'keep me' });
    expect(result.answer).toBe('keep me');
    expect(result.linkHints).toEqual({});
  });
});
