// Unit tests for services/ai-assist/llm/anthropicProvider.
// The Anthropic SDK is mocked: the constructor yields a client whose
// `messages.stream(...)` returns a fake stream (async-iterable of events plus a
// `finalMessage()` resolver). The orchestrator owns the multi-round tool loop;
// here we only exercise a single `stream` turn across its branches.

const streamMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const AnthropicCtor = jest.fn().mockImplementation(() => ({
    messages: { stream: streamMock }
  }));
  return { __esModule: true, default: AnthropicCtor };
});

jest.mock('../../../../config', () => ({
  ANTHROPIC_API_KEY: 'test-anthropic-key'
}));

import Anthropic from '@anthropic-ai/sdk';
import anthropicProvider from '../../../../services/ai-assist/llm/anthropicProvider';

const AnthropicCtor = jest.mocked(Anthropic);

type Event = Record<string, unknown>;

// Build a fake message-stream object matching what the provider consumes.
const makeStream = (events: Event[], finalMessage: unknown) => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) {
      yield e;
    }
  },
  finalMessage: jest.fn().mockResolvedValue(finalMessage)
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('anthropicProvider metadata', () => {
  it('exposes provider name and default model', () => {
    expect(anthropicProvider.name).toBe('anthropic');
    expect(anthropicProvider.defaultModel).toBe('claude-opus-4-8');
  });
});

describe('anthropicProvider.stream - streaming and text extraction', () => {
  it('emits text deltas via onToken and joins text blocks into the final text', async () => {
    streamMock.mockReturnValue(
      makeStream(
        [
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hel' }
          },
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'lo' }
          }
        ],
        {
          content: [
            { type: 'text', text: 'Hel' },
            { type: 'text', text: 'lo' }
          ],
          usage: { input_tokens: 3, output_tokens: 2 },
          stop_reason: 'end_turn'
        }
      )
    );

    const tokens: string[] = [];
    const result = await anthropicProvider.stream(
      { system: 'sys', turns: [{ role: 'user', content: 'hi' }] },
      { onToken: async (t) => void tokens.push(t) }
    );

    expect(tokens).toEqual(['Hel', 'lo']);
    expect(result.text).toBe('Hello');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
    expect(result.model).toBe('claude-opus-4-8');
    expect(result.stopReason).toBe('end_turn');

    // Default model used; no tools key when none provided.
    const payload = streamMock.mock.calls[0][0];
    expect(payload.model).toBe('claude-opus-4-8');
    expect(payload.tools).toBeUndefined();
  });

  it('ignores non-text-delta and empty-text events when emitting tokens', async () => {
    streamMock.mockReturnValue(
      makeStream(
        [
          { type: 'message_start' },
          { type: 'content_block_delta', delta: { type: 'input_json_delta' } },
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '' }
          },
          { type: 'content_block_delta' }, // delta undefined -> guarded
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'real' }
          }
        ],
        { content: [{ type: 'text', text: 'real' }] }
      )
    );

    const tokens: string[] = [];
    await anthropicProvider.stream(
      { system: 's', turns: [{ role: 'user', content: 'q' }] },
      { onToken: (t) => void tokens.push(t) }
    );

    expect(tokens).toEqual(['real']);
  });

  it('works with no onToken option (options default {})', async () => {
    streamMock.mockReturnValue(
      makeStream(
        [
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'x' }
          }
        ],
        { content: [{ type: 'text', text: 'x' }] }
      )
    );

    const result = await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });

    expect(result.text).toBe('x');
  });

  it('swallows onToken errors (best-effort streaming)', async () => {
    streamMock.mockReturnValue(
      makeStream(
        [
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'boom' }
          }
        ],
        { content: [{ type: 'text', text: 'boom' }] }
      )
    );

    const onToken = jest.fn().mockRejectedValue(new Error('emit fail'));
    await expect(
      anthropicProvider.stream(
        { system: 's', turns: [{ role: 'user', content: 'q' }] },
        { onToken }
      )
    ).resolves.toMatchObject({ text: 'boom' });
    expect(onToken).toHaveBeenCalled();
  });

  it('skips emitting when onToken is not a function', async () => {
    streamMock.mockReturnValue(
      makeStream(
        [
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'y' }
          }
        ],
        { content: [{ type: 'text', text: 'y' }] }
      )
    );

    const result = await anthropicProvider.stream(
      { system: 's', turns: [{ role: 'user', content: 'q' }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { onToken: 'not-a-fn' as any }
    );
    expect(result.text).toBe('y');
  });
});

describe('anthropicProvider.stream - tool calls and missing content', () => {
  it('extracts tool_use blocks into neutral toolCalls and defaults missing input to {}', async () => {
    streamMock.mockReturnValue(
      makeStream([], {
        content: [
          { type: 'text', text: 'thinking' },
          {
            type: 'tool_use',
            id: 'tc1',
            name: 'find_students',
            input: { q: 'Alice' }
          },
          { type: 'tool_use', id: 'tc2', name: 'noargs' } // no input -> {}
        ],
        usage: {},
        stop_reason: 'tool_use'
      })
    );

    const result = await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'find Alice' }],
      tools: [
        {
          name: 'find_students',
          description: 'd',
          parameters: { type: 'object' }
        }
      ]
    });

    expect(result.text).toBe('thinking');
    expect(result.toolCalls).toEqual([
      { id: 'tc1', name: 'find_students', input: { q: 'Alice' } },
      { id: 'tc2', name: 'noargs', input: {} }
    ]);
    expect(result.stopReason).toBe('tool_use');

    // tools provided -> tools key present and mapped to input_schema
    const payload = streamMock.mock.calls[0][0];
    expect(payload.tools).toEqual([
      {
        name: 'find_students',
        description: 'd',
        input_schema: { type: 'object' }
      }
    ]);
  });

  it('handles a finalMessage with no content (blocks default to [])', async () => {
    streamMock.mockReturnValue(makeStream([], {})); // no content field

    const result = await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
  });

  it('handles a null/undefined final message (message?. guards)', async () => {
    streamMock.mockReturnValue(makeStream([], null));

    const result = await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toBeUndefined();
  });

  it('omits the tools key when tools is an empty array', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'ok' }] })
    );

    await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }],
      tools: []
    });

    expect(streamMock.mock.calls[0][0].tools).toBeUndefined();
  });
});

describe('anthropicProvider.stream - model override and message mapping', () => {
  it('honors a model override', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'ok' }] })
    );

    const result = await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }],
      model: 'claude-sonnet-4-5'
    });

    expect(result.model).toBe('claude-sonnet-4-5');
    expect(streamMock.mock.calls[0][0].model).toBe('claude-sonnet-4-5');
  });

  it('maps user, assistant (text + toolCalls), and tool turns', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'done' }] })
    );

    await anthropicProvider.stream({
      system: 's',
      turns: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          text: 'let me check',
          toolCalls: [{ id: 'a1', name: 'tool', input: { x: 1 } }]
        },
        {
          role: 'tool',
          results: [
            { id: 'a1', name: 'tool', output: 'result', isError: false }
          ]
        }
      ]
    });

    const messages = streamMock.mock.calls[0][0].messages;
    expect(messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }]
    });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me check' },
        { type: 'tool_use', id: 'a1', name: 'tool', input: { x: 1 } }
      ]
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'a1',
          content: 'result',
          is_error: false
        }
      ]
    });
  });

  it('falls back to a space for an empty assistant turn and stringifies nullish fields', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'ok' }] })
    );

    await anthropicProvider.stream({
      system: 's',
      turns: [
        // user content nullish -> ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'user', content: null as any },
        // assistant with no text and no toolCalls -> content [{text:' '}]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'assistant' } as any,
        // tool turn with no results -> content []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'tool' } as any,
        // tool result with nullish output and missing isError
        {
          role: 'tool',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          results: [{ id: 't', name: 'n', output: null as any }]
        }
      ]
    });

    const messages = streamMock.mock.calls[0][0].messages;
    expect(messages[0].content[0].text).toBe('');
    expect(messages[1].content).toEqual([{ type: 'text', text: ' ' }]);
    expect(messages[2].content).toEqual([]);
    expect(messages[3].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 't',
      content: '',
      is_error: false
    });
  });

  it('assistant turn with toolCalls but no text omits the text block', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'ok' }] })
    );

    await anthropicProvider.stream({
      system: 's',
      turns: [
        {
          role: 'assistant',
          text: '',
          // input omitted -> falls through `toolCall.input || {}`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolCalls: [{ id: 'a1', name: 'tool' } as any]
        }
      ]
    });

    const messages = streamMock.mock.calls[0][0].messages;
    expect(messages[0].content).toEqual([
      { type: 'tool_use', id: 'a1', name: 'tool', input: {} }
    ]);
  });

  it('filters out unknown turn roles (null mapping)', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'ok' }] })
    );

    await anthropicProvider.stream({
      system: 's',
      turns: [
        { role: 'user', content: 'keep' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'system', content: 'drop' } as any
      ]
    });

    const messages = streamMock.mock.calls[0][0].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content[0].text).toBe('keep');
  });

  it('defaults turns to [] when stream is called with no params', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'ok' }] })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (anthropicProvider.stream as any)();
    expect(result.text).toBe('ok');
    expect(streamMock.mock.calls[0][0].messages).toEqual([]);
  });
});

describe('anthropicProvider - client construction', () => {
  it('constructs and caches the Anthropic client across calls', async () => {
    streamMock.mockReturnValue(
      makeStream([], { content: [{ type: 'text', text: 'a' }] })
    );

    await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    await anthropicProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });

    // Cached: constructor invoked at most once across the suite.
    expect(AnthropicCtor.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
