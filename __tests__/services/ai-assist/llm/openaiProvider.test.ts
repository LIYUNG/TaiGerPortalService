// Unit tests for services/ai-assist/llm/openaiProvider.
// The OpenAI Responses client is mocked via the services/openai module (the same
// seam answerComposer.test.ts uses). We exercise both the streaming path
// (responses.stream present) and the non-streaming fallback (responses.create),
// plus text/tool-call extraction across the broad Responses output shapes.

jest.mock('../../../../services/openai', () => ({
  openAIClient: {
    responses: {
      create: jest.fn(),
      stream: jest.fn()
    }
  },
  OpenAiModel: { GPT_5_4_mini: 'gpt-5.4-mini' }
}));

import { openAIClient } from '../../../../services/openai';
import openaiProvider from '../../../../services/ai-assist/llm/openaiProvider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = openAIClient as any;

const makeStream = (
  events: Record<string, unknown>[],
  finalResponse: unknown
) => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) {
      yield e;
    }
  },
  finalResponse: jest.fn().mockResolvedValue(finalResponse)
});

beforeEach(() => {
  jest.clearAllMocks();
  client.responses.create = jest.fn();
  client.responses.stream = jest.fn();
});

describe('openaiProvider metadata', () => {
  it('exposes provider name and default model', () => {
    expect(openaiProvider.name).toBe('openai');
    expect(openaiProvider.defaultModel).toBe('gpt-5.4-mini');
  });
});

describe('openaiProvider.stream - streaming path', () => {
  it('emits output_text deltas and returns extracted text/usage/status', async () => {
    const finalResponse = {
      output_text: 'Hello',
      usage: { input_tokens: 4, output_tokens: 1 },
      status: 'completed'
    };
    client.responses.stream.mockReturnValue(
      makeStream(
        [
          { type: 'response.output_text.delta', delta: 'Hel' },
          { type: 'response.output_text.delta', delta: 'lo' },
          { type: 'other.event', delta: 'ignored' },
          { type: 'response.output_text.delta', delta: '' }, // empty -> skip
          { type: 'response.output_text.delta', delta: 42 } // non-string -> skip
        ],
        finalResponse
      )
    );

    const tokens: string[] = [];
    const result = await openaiProvider.stream(
      { system: 'sys', turns: [{ role: 'user', content: 'hi' }] },
      { onToken: async (t) => void tokens.push(t) }
    );

    expect(tokens).toEqual(['Hel', 'lo']);
    expect(result.text).toBe('Hello');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toEqual({ input_tokens: 4, output_tokens: 1 });
    expect(result.model).toBe('gpt-5.4-mini');
    expect(result.stopReason).toBe('completed');
    expect(client.responses.create).not.toHaveBeenCalled();
  });

  it('streams with no onToken (options default {})', async () => {
    client.responses.stream.mockReturnValue(
      makeStream([{ type: 'response.output_text.delta', delta: 'x' }], {
        output_text: 'x'
      })
    );

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.text).toBe('x');
  });

  it('swallows onToken errors during streaming', async () => {
    client.responses.stream.mockReturnValue(
      makeStream([{ type: 'response.output_text.delta', delta: 'x' }], {
        output_text: 'x'
      })
    );
    const onToken = jest.fn().mockRejectedValue(new Error('emit fail'));

    await expect(
      openaiProvider.stream(
        { system: 's', turns: [{ role: 'user', content: 'q' }] },
        { onToken }
      )
    ).resolves.toMatchObject({ text: 'x' });
    expect(onToken).toHaveBeenCalled();
  });

  it('skips emitting when onToken is not a function', async () => {
    client.responses.stream.mockReturnValue(
      makeStream([{ type: 'response.output_text.delta', delta: 'x' }], {
        output_text: 'x'
      })
    );

    const result = await openaiProvider.stream(
      { system: 's', turns: [{ role: 'user', content: 'q' }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { onToken: 'nope' as any }
    );
    expect(result.text).toBe('x');
  });
});

describe('openaiProvider.stream - non-streaming fallback', () => {
  it('uses responses.create when stream is unavailable and emits the whole text', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({
      output_text: 'Full answer',
      usage: { input_tokens: 2 },
      status: 'completed'
    });

    const tokens: string[] = [];
    const result = await openaiProvider.stream(
      { system: 's', turns: [{ role: 'user', content: 'q' }] },
      { onToken: (t) => void tokens.push(t) }
    );

    expect(tokens).toEqual(['Full answer']);
    expect(result.text).toBe('Full answer');
    expect(result.usage).toEqual({ input_tokens: 2 });
    expect(result.stopReason).toBe('completed');
  });

  it('non-streaming with empty text does not emit a token', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: '' });

    const tokens: string[] = [];
    const result = await openaiProvider.stream(
      { system: 's', turns: [{ role: 'user', content: 'q' }] },
      { onToken: (t) => void tokens.push(t) }
    );

    expect(tokens).toEqual([]);
    expect(result.text).toBe('');
  });
});

describe('openaiProvider - getResponseText branches', () => {
  it('builds text from output message parts (text and content fields) when output_text absent', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({
      output: [
        { type: 'reasoning' },
        {
          type: 'message',
          content: [{ text: 'part one' }, { content: 'part two' }, { text: '' }]
        }
      ]
    });

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.text).toBe('part one\npart two');
  });

  it('returns empty text when no message item and no output (defaults)', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({}); // no output_text, no output

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.text).toBe('');
  });

  it('returns empty text when the message has no content array', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({
      output: [{ type: 'message' }] // content undefined -> []
    });

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.text).toBe('');
  });
});

describe('openaiProvider - getToolCalls branches', () => {
  it('parses function_call arguments JSON into input', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'c1',
          name: 'find_students',
          arguments: '{"query":"Alice"}'
        }
      ]
    });

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'find_students', input: { query: 'Alice' } }
    ]);
  });

  it('defaults input to {} for missing arguments and for invalid JSON', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({
      output: [
        { type: 'function_call', call_id: 'c1', name: 'noargs' }, // no arguments
        {
          type: 'function_call',
          call_id: 'c2',
          name: 'bad',
          arguments: 'not json{'
        }
      ]
    });

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'noargs', input: {} },
      { id: 'c2', name: 'bad', input: {} }
    ]);
  });

  it('returns no tool calls when output is missing entirely', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: 'hi' });

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.toolCalls).toEqual([]);
  });
});

describe('openaiProvider.stream - request payload mapping', () => {
  it('honors a model override and maps all turn kinds plus tools', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: 'ok' });

    const result = await openaiProvider.stream({
      system: 'sys-instr',
      model: 'gpt-5.4-nano',
      turns: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          text: 'checking',
          toolCalls: [{ id: 'a1', name: 'tool', input: { x: 1 } }]
        },
        { role: 'tool', results: [{ id: 'a1', name: 'tool', output: 'res' }] }
      ],
      tools: [
        { name: 'tool', description: 'd', parameters: { type: 'object' } }
      ]
    });

    expect(result.model).toBe('gpt-5.4-nano');
    const payload = client.responses.create.mock.calls[0][0];
    expect(payload.model).toBe('gpt-5.4-nano');
    expect(payload.instructions).toBe('sys-instr');
    expect(payload.input).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'checking' },
      {
        type: 'function_call',
        call_id: 'a1',
        name: 'tool',
        arguments: '{"x":1}'
      },
      { type: 'function_call_output', call_id: 'a1', output: 'res' }
    ]);
    expect(payload.tools).toEqual([
      {
        type: 'function',
        name: 'tool',
        description: 'd',
        parameters: { type: 'object' }
      }
    ]);
  });

  it('omits the tools key when no tools and uses default model', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: 'ok' });

    await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }],
      tools: []
    });

    const payload = client.responses.create.mock.calls[0][0];
    expect(payload.tools).toBeUndefined();
    expect(payload.model).toBe('gpt-5.4-mini');
  });

  it('stringifies nullish user content, omits empty assistant text, and handles missing collections', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: 'ok' });

    await openaiProvider.stream({
      system: 's',
      turns: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'user', content: null as any }, // -> ''
        // assistant with empty text + missing toolCalls -> nothing pushed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'assistant', text: '' } as any,
        // assistant with no text but a toolCall with missing input -> arguments '{}'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'assistant', toolCalls: [{ id: 'b1', name: 't' }] } as any,
        // tool turn with no results -> nothing pushed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'tool' } as any,
        // tool result with nullish output -> ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          role: 'tool',
          results: [{ id: 'r1', name: 'n', output: null as any }]
        }
      ]
    });

    const input = client.responses.create.mock.calls[0][0].input;
    expect(input).toEqual([
      { role: 'user', content: '' },
      {
        type: 'function_call',
        call_id: 'b1',
        name: 't',
        arguments: '{}'
      },
      { type: 'function_call_output', call_id: 'r1', output: '' }
    ]);
  });

  it('defaults turns to [] when stream is called with no params', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: 'ok' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (openaiProvider.stream as any)();
    expect(result.text).toBe('ok');
    expect(client.responses.create.mock.calls[0][0].input).toEqual([]);
  });
});

describe('openaiProvider.stream - usage/status defaults', () => {
  it('returns undefined usage and status when response lacks them', async () => {
    delete client.responses.stream;
    client.responses.create.mockResolvedValue({ output_text: 'ok' });

    const result = await openaiProvider.stream({
      system: 's',
      turns: [{ role: 'user', content: 'q' }]
    });
    expect(result.usage).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
  });
});
