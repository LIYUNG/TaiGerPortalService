// Unit tests for services/ai-assist/orchestrator (single agentic tool loop).
// No DB: the postgres handle is a hand-rolled Drizzle double. The LLM provider,
// the tool registry, and the link-hint extractor are all mocked.

jest.mock('../../../services/ai-assist/llm', () => ({
  getLlmProvider: jest.fn(),
  getConfiguredModel: jest.fn(() => undefined),
  getModelLabel: jest.fn(() => 'anthropic:claude-opus-4-8')
}));

jest.mock('../../../services/ai-assist/aiTools', () => ({
  definitions: [],
  hasTool: jest.fn(() => true),
  runTool: jest.fn()
}));

jest.mock('../../../services/ai-assist/answerComposer', () => ({
  extractAnswerReferences: jest.fn()
}));

import { getLlmProvider } from '../../../services/ai-assist/llm';
import aiTools from '../../../services/ai-assist/aiTools';
import { extractAnswerReferences } from '../../../services/ai-assist/answerComposer';
import orchestrator from '../../../services/ai-assist/orchestrator';

const { runAiAssist } = orchestrator;

const makePostgres = ({ selectResults = [] } = {}) => {
  let insertId = 0;
  const queue = [...selectResults];

  const selectChain = () => {
    const resolved = queue.length ? queue.shift() : [];
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(resolved)
    };
    return chain;
  };

  return {
    select: jest.fn(selectChain),
    insert: () => ({
      values: (values) => ({
        returning: () => {
          insertId += 1;
          return Promise.resolve([{ id: `row_${insertId}`, ...values }]);
        }
      })
    })
  };
};

const REQ = { user: { role: 'Agent', _id: 'agent_1' } };

const makeProvider = () => ({
  name: 'anthropic',
  defaultModel: 'claude-opus-4-8',
  stream: jest.fn()
});

beforeEach(() => {
  jest.clearAllMocks();
  extractAnswerReferences.mockImplementation(async ({ answer }) => ({
    answer,
    linkHints: {}
  }));
});

describe('runAiAssist - single agentic loop', () => {
  it('returns a final answer when the model makes no tool calls', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'Here is the answer.',
      toolCalls: [],
      usage: { input_tokens: 10, output_tokens: 5 }
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'How many students do I have?',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.answer).toBe('Here is the answer.');
    expect(result.trace).toEqual([]);
    expect(result.assistantMessage.content).toBe('Here is the answer.');
    expect(aiTools.runTool).not.toHaveBeenCalled();
    expect(provider.stream).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call then returns the final answer', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 't1', name: 'find_students', input: { query: 'Alice' } }
        ],
        usage: {}
      })
      .mockResolvedValueOnce({
        text: 'Alice has 3 active applications.',
        toolCalls: [],
        usage: {}
      });
    getLlmProvider.mockReturnValue(provider);
    aiTools.runTool.mockResolvedValue({ data: [{ id: 's1', name: 'Alice' }] });

    const postgres = makePostgres({ selectResults: [[], []] });
    const progress = [];
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'Summarize @Alice',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en',
      onProgress: async (event) => {
        progress.push(event.type);
      }
    });

    expect(aiTools.runTool).toHaveBeenCalledWith(REQ, 'find_students', {
      query: 'Alice'
    });
    expect(result.answer).toBe('Alice has 3 active applications.');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].toolName).toBe('find_students');
    expect(result.trace[0].status).toBe('success');
    expect(provider.stream).toHaveBeenCalledTimes(2);
    expect(progress).toContain('tool_start');
    expect(progress).toContain('tool_done');
  });

  it('records a failed tool call without aborting the loop', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'read_document', input: {} }],
        usage: {}
      })
      .mockResolvedValueOnce({
        text: 'I could not read that document.',
        toolCalls: [],
        usage: {}
      });
    getLlmProvider.mockReturnValue(provider);
    aiTools.runTool.mockRejectedValue(new Error('Document thread not found'));

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'review the cv',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.trace[0].status).toBe('failed');
    expect(result.trace[0].errorMessage).toBe('Document thread not found');
    expect(result.answer).toBe('I could not read that document.');
  });

  it('forces the preferred language for an analysisMode deep-dive even when the prompt is English', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'Perform a full deep-dive analysis of student @Alice (id: s1).',
      req: REQ,
      assistContext: {
        mentionedStudent: { id: 's1', displayName: 'Alice' },
        analysisMode: true
      },
      preferredLanguage: 'zh-TW'
    });

    const { system } = provider.stream.mock.calls[0][0];
    expect(system).toContain('Respond in Traditional Chinese');
    expect(system).not.toContain('Match the language and writing system');
    expect(system).toContain('STRUCTURED OUTPUT FORMAT');
  });

  it('matches the user message language for a normal (non-analysis) chat', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'What is the application deadline?',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'zh-TW'
    });

    const { system } = provider.stream.mock.calls[0][0];
    expect(system).toContain('Match the language and writing system');
    expect(system).not.toContain('STRUCTURED OUTPUT FORMAT');
  });

  it('uses an explicitly mentioned student as the active student', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'Done.',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'status?',
      req: REQ,
      assistContext: {
        mentionedStudent: { id: 's1', displayName: 'Alice' }
      },
      preferredLanguage: 'en'
    });

    expect(result.activeStudent).toEqual({ id: 's1', displayName: 'Alice' });
  });
});
