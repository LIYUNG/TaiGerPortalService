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

import llm from '../../../services/ai-assist/llm';
import aiToolsReal from '../../../services/ai-assist/aiTools';
import answerComposer from '../../../services/ai-assist/answerComposer';
import orchestrator from '../../../services/ai-assist/orchestrator';

const { getLlmProvider } = llm as unknown as Record<string, jest.Mock>;
const aiTools = aiToolsReal as unknown as Record<string, jest.Mock>;
const { extractAnswerReferences } = answerComposer as unknown as Record<
  string,
  jest.Mock
>;

const { runAiAssist } = orchestrator;

const makePostgres = ({
  selectResults = []
}: { selectResults?: any[] } = {}) => {
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
      values: (values: any) => ({
        returning: () => {
          insertId += 1;
          return Promise.resolve([{ id: `row_${insertId}`, ...values }]);
        }
      })
    })
  };
};

const REQ: any = { user: { role: 'Agent', _id: 'agent_1' } };

const makeProvider = () => ({
  name: 'anthropic',
  defaultModel: 'claude-opus-4-8',
  stream: jest.fn()
});

beforeEach(() => {
  jest.clearAllMocks();
  extractAnswerReferences.mockImplementation(async ({ answer }: any) => ({
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
    const progress: any[] = [];
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

  it('falls back to a default answer when the model produces no text', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: '',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'something unanswerable',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.answer).toContain('could not produce an answer');
  });

  it('uses the conversation-bound student as the active student and emits a bound-student hint', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    // conversation row carries a bound student; messages window is empty.
    const postgres = makePostgres({
      selectResults: [
        [{ id: 'conv_1', studentId: 's7', studentDisplayName: 'Grace' }],
        []
      ]
    });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'how is it going?',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.activeStudent).toEqual({ id: 's7', displayName: 'Grace' });
    const { turns } = provider.stream.mock.calls[0][0];
    const lastTurn = turns[turns.length - 1];
    expect(lastTurn.content).toContain(
      'Active student in this conversation: Grace'
    );
  });

  it('resolves the active student from the first student surfaced by a tool', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'find_students', input: { query: 'x' } }],
        usage: {}
      })
      .mockResolvedValueOnce({
        text: 'Found someone.',
        toolCalls: [],
        usage: {}
      });
    getLlmProvider.mockReturnValue(provider);
    // Tool result with student + program shapes -> candidate collection (lines 318-335).
    aiTools.runTool.mockResolvedValue({
      students: [{ id: 's3', name: 'Ivy', email: 'ivy@x.com' }],
      program: { id: 'p9', name: 'MSc Data', school: 'TUM' }
    });

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'find a student',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.activeStudent).toEqual({ id: 's3', displayName: 'Ivy' });
  });

  it('handles an explicit mention without a display name and a tool call missing input', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        // toolCall has no `input` -> executeToolCall args default {} (line 371)
        text: '',
        toolCalls: [{ id: 't1', name: 'find_students' }],
        usage: {}
      })
      .mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: {} });
    getLlmProvider.mockReturnValue(provider);
    aiTools.runTool.mockResolvedValue({ ok: true });

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'status',
      req: REQ,
      // mentioned student with no displayName -> displayName || '' / || null falsy branches (lines 499, 512)
      assistContext: { mentionedStudent: { id: 's1' } },
      preferredLanguage: 'en'
    });

    expect(aiTools.runTool).toHaveBeenCalledWith(REQ, 'find_students', {});
    expect(result.activeStudent).toEqual({ id: 's1', displayName: null });
    const { turns } = provider.stream.mock.calls[0][0];
    const userHintTurn = turns.find(
      (t: any) =>
        t.role === 'user' &&
        typeof t.content === 'string' &&
        t.content.includes('id: s1')
    );
    expect(userHintTurn).toBeDefined();
  });

  it('collects candidates across mixed shapes (role-only student, displayName, program without name)', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'find_students', input: {} }],
        usage: {}
      })
      .mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: {} });
    getLlmProvider.mockReturnValue(provider);
    aiTools.runTool.mockResolvedValue({
      // student identified by role (not email) and displayName (not name) -> line 320/321/295 alt branches
      primary: { id: 's10', displayName: 'Kay', role: 'Student' },
      // student-ish but missing id -> addStudentCandidate guard (line 296)
      ghost: { name: 'NoId', email: 'x@y.com' },
      // program with id but no name -> program guard false (line 328)
      program: { id: 'p1', school: 'TU' },
      // primitive nested values -> collectCandidatesFromValue early return (line 308)
      note: 'plain string',
      count: 42,
      nothing: null
    });

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'find',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.activeStudent).toEqual({ id: 's10', displayName: 'Kay' });
  });

  it('rejects an unknown tool name as a failed tool call', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'mystery_tool', input: {} }],
        usage: {}
      })
      .mockResolvedValueOnce({ text: 'Handled.', toolCalls: [], usage: {} });
    getLlmProvider.mockReturnValue(provider);
    aiTools.hasTool.mockReturnValueOnce(false);

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'do magic',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.trace[0].status).toBe('failed');
    expect(result.trace[0].errorMessage).toContain('Unknown AI Assist tool');
  });

  it('replays prior assistant and user messages into the turn list', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    // messages window (returned newest-first, reversed inside): one assistant + one user.
    const postgres = makePostgres({
      selectResults: [
        [{ id: 'conv_1' }],
        [
          { role: 'assistant', content: 'Previous answer' },
          { role: 'user', content: 'Previous question' }
        ]
      ]
    });
    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'next',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    const { turns } = provider.stream.mock.calls[0][0];
    const assistantTurn = turns.find((t: any) => t.role === 'assistant');
    expect(assistantTurn).toMatchObject({
      role: 'assistant',
      text: 'Previous answer',
      toolCalls: []
    });
  });

  it('returns a benign default context when postgres has no select capability', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    // postgres without `select` -> loadConversationContext early return (line 254-255).
    let insertId = 0;
    const postgres = {
      insert: () => ({
        values: (values: any) => ({
          returning: () => {
            insertId += 1;
            return Promise.resolve([{ id: `row_${insertId}`, ...values }]);
          }
        })
      })
    };
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.answer).toBe('ok');
  });

  it.each([
    ['Editor', 'As an editor, your primary concern is document quality'],
    ['Manager', 'As a manager, your primary concern is team-level health'],
    ['Agent', 'As an agent, your primary concern is application progress']
  ])(
    'adds %s-specific role guidance to the system prompt',
    async (role, marker) => {
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
        message: 'hi',
        req: { user: { role, _id: 'u1' } } as any,
        assistContext: {},
        preferredLanguage: 'en'
      });

      const { system } = provider.stream.mock.calls[0][0];
      expect(system).toContain(marker);
    }
  );

  it('adds no role guidance for an unrecognized role', async () => {
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
      message: 'hi',
      req: { user: { role: 'Student', _id: 'u1' } } as any,
      assistContext: {},
      preferredLanguage: 'en'
    });

    const { system } = provider.stream.mock.calls[0][0];
    expect(system).not.toContain('your primary concern');
  });

  it.each([
    ['zh-CN', 'Simplified Chinese'],
    ['zh', 'Chinese'],
    ['fr', 'English']
  ])(
    'maps preferred language %s to %s in analysis mode',
    async (pref, expected) => {
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
        message: 'analyze',
        req: REQ,
        assistContext: { analysisMode: true },
        preferredLanguage: pref
      });

      const { system } = provider.stream.mock.calls[0][0];
      expect(system).toContain(`Respond in ${expected}`);
    }
  );

  it('responds in the preferred language for an empty non-analysis message', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    // message is only the @mention which gets stripped -> empty -> preferred language path (line 161).
    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '@Alice',
      req: REQ,
      assistContext: { mentionedStudent: { id: 's1', displayName: 'Alice' } },
      preferredLanguage: 'zh-CN'
    });

    const { system } = provider.stream.mock.calls[0][0];
    expect(system).toContain('Respond in Simplified Chinese');
    expect(system).not.toContain('Match the language and writing system');
  });

  it('injects the reply-draft system prompt and no analysis/language directive when replyMode is set', async () => {
    const provider = makeProvider();
    provider.stream.mockResolvedValueOnce({
      text: '您好，關於您的問題…',
      toolCalls: [],
      usage: {}
    });
    getLlmProvider.mockReturnValue(provider);

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: "Draft a reply to the student's most recent message.",
      req: REQ,
      assistContext: { mentionedStudent: { id: 's1', displayName: 'Alice' } },
      replyMode: true,
      preferredLanguage: 'zh-TW'
    });

    const { system } = provider.stream.mock.calls[0][0];
    expect(system).toContain('REPLY DRAFT MODE');
    expect(system).not.toContain('STRUCTURED OUTPUT FORMAT');
    // Reply mode owns the language rule, so no competing directive is emitted.
    expect(system).not.toContain('Respond in');
    expect(system).not.toContain('Match the language and writing system');
    // Reply mode also carries the curated TaiGer resource-link catalog.
    expect(system).toContain('TAIGER RESOURCE LINKS');
    expect(system).toContain('docs/uniassist');
    expect(result.answer).toBe('您好，關於您的問題…');
  });

  it('also enables reply-draft mode via assistContext.replyMode', async () => {
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
      message: 'reply please',
      req: REQ,
      assistContext: { replyMode: true },
      preferredLanguage: 'en'
    });

    const { system } = provider.stream.mock.calls[0][0];
    expect(system).toContain('REPLY DRAFT MODE');
  });

  it('tolerates a non-serializable tool result and a progress emitter that throws', async () => {
    const provider = makeProvider();
    provider.stream
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'find_students', input: {} }],
        usage: {}
      })
      .mockResolvedValueOnce({ text: 'done', toolCalls: [], usage: {} });
    getLlmProvider.mockReturnValue(provider);
    // BigInt is not JSON-serializable -> JSON.stringify throws -> stringifyToolOutput catch (line 360).
    // (A circular object would infinitely recurse in candidate collection, so use BigInt.)
    aiTools.runTool.mockResolvedValue({ value: BigInt(1) });

    const postgres = makePostgres({ selectResults: [[], []] });
    const result = await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'go',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en',
      onProgress: () => {
        throw new Error('progress sink down'); // safeEmitProgress swallows (line 351-353)
      }
    });

    expect(result.answer).toBe('done');
    expect(result.trace[0].status).toBe('success');
  });
});
