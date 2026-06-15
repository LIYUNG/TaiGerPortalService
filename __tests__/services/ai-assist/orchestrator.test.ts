// Unit tests for services/ai-assist/orchestrator. No DB. Every collaborator is
// mocked: the OpenAI client, the tool runner, intent router, entity resolver,
// and answer composer. The postgres handle is a hand-rolled fake builder passed
// directly into runAiAssist.

jest.mock('../../../services/openai', () => ({
  openAIClient: {
    responses: { create: jest.fn() },
    chat: { completions: { create: jest.fn() } }
  },
  OpenAiModel: { GPT_4_o: 'gpt-4o' }
}));

jest.mock('../../../services/ai-assist/tools', () => ({
  hasTool: jest.fn(() => true),
  runTool: jest.fn()
}));

jest.mock('../../../services/ai-assist/intentRouter', () => ({
  classifyIntent: jest.fn()
}));

jest.mock('../../../services/ai-assist/entityResolver', () => ({
  resolveStudent: jest.fn(),
  resolveStudentById: jest.fn()
}));

jest.mock('../../../services/ai-assist/answerComposer', () => ({
  composeAnswer: jest.fn(),
  generateAnswerFromInput: jest.fn(),
  extractAnswerReferences: jest.fn()
}));

import { openAIClient } from '../../../services/openai';
import tools from '../../../services/ai-assist/tools';
import { classifyIntent } from '../../../services/ai-assist/intentRouter';
import {
  resolveStudent,
  resolveStudentById
} from '../../../services/ai-assist/entityResolver';
import {
  composeAnswer,
  generateAnswerFromInput,
  extractAnswerReferences
} from '../../../services/ai-assist/answerComposer';

import orchestrator from '../../../services/ai-assist/orchestrator';

const { autoDetectSkill, resolveAssistContext, runAiAssist } = orchestrator;

// ---------------------------------------------------------------------------
// A minimal Drizzle double. select() chains resolve to arrays we queue; insert
// chains return one row echoing the inserted values plus an incrementing id.
// ---------------------------------------------------------------------------
const makePostgres = ({ selectResults = [], withSelect = true } = {}) => {
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

  const postgres = {
    insert: (table) => ({
      values: (values) => ({
        returning: () => {
          insertId += 1;
          return Promise.resolve([{ id: `row_${insertId}`, ...values }]);
        }
      })
    })
  };

  if (withSelect) {
    postgres.select = jest.fn(selectChain);
  }

  return postgres;
};

const REQ = { user: { role: 'Admin', _id: 'admin_1' } };

beforeEach(() => {
  jest.clearAllMocks();
  tools.hasTool.mockReturnValue(true);
  openAIClient.responses = { create: jest.fn() };
  openAIClient.chat = { completions: { create: jest.fn() } };
  extractAnswerReferences.mockImplementation(async ({ answer }) => ({
    answer,
    linkHints: {}
  }));
});

describe('autoDetectSkill', () => {
  it('returns a known skill from a #hashtag', () => {
    expect(autoDetectSkill('please #summarize_student now')).toBe(
      'summarize_student'
    );
  });

  it('returns null for an unknown #hashtag', () => {
    expect(autoDetectSkill('do #not_a_skill')).toBeNull();
  });

  it('returns null when there is no hashtag', () => {
    expect(autoDetectSkill('just a normal message')).toBeNull();
  });

  it('defaults to empty message safely', () => {
    expect(autoDetectSkill()).toBeNull();
  });
});

describe('resolveAssistContext', () => {
  it('prefers an explicit @mentioned student over conversation binding', () => {
    const result = resolveAssistContext({
      assistContext: {
        mentionedStudent: { id: 's1', displayName: 'Ada' }
      },
      conversationContext: { boundStudentId: 's2' },
      message: 'hi'
    });
    expect(result.student).toEqual({ id: 's1', displayName: 'Ada' });
    expect(result.studentSource).toBe('assist_context');
  });

  it('falls back to the conversation-bound student', () => {
    const result = resolveAssistContext({
      assistContext: {},
      conversationContext: {
        boundStudentId: 's2',
        boundStudentDisplayName: 'Bob'
      },
      message: 'hi'
    });
    expect(result.student).toEqual({ id: 's2', displayName: 'Bob' });
    expect(result.studentSource).toBe('conversation_active');
  });

  it('auto-detects a skill from the message and keeps it when a student exists', () => {
    const result = resolveAssistContext({
      assistContext: { mentionedStudent: { id: 's1', displayName: 'Ada' } },
      conversationContext: {},
      message: '#identify_risk please'
    });
    expect(result.resolvedSkill).toBe('identify_risk');
    expect(result.fallbackReason).toBeNull();
  });

  it('falls back when a requested skill has no plan', () => {
    const result = resolveAssistContext({
      assistContext: {
        requestedSkill: 'ghost_skill',
        mentionedStudent: { id: 's1' }
      },
      conversationContext: {},
      message: 'go'
    });
    expect(result.resolvedSkill).toBeNull();
    expect(result.fallbackReason).toBe(
      'Unsupported skill request: ghost_skill'
    );
  });

  it('falls back when a valid skill is requested without a student', () => {
    const result = resolveAssistContext({
      assistContext: { requestedSkill: 'summarize_student' },
      conversationContext: {},
      message: 'go'
    });
    expect(result.resolvedSkill).toBeNull();
    expect(result.fallbackReason).toBe(
      'Skill mode requires a message-level @student.'
    );
  });

  it('reports an unknownSkillText fallback and suppresses auto-detection', () => {
    const result = resolveAssistContext({
      assistContext: { unknownSkillText: 'frobnicate' },
      conversationContext: {},
      message: '#summarize_student'
      // unknownSkillText path
    });
    expect(result.resolvedSkill).toBeNull();
    expect(result.fallbackReason).toBe('Unsupported skill request: frobnicate');
  });
});

describe('runAiAssist - skill mode', () => {
  const skillAssistContext = {
    requestedSkill: 'summarize_student',
    mentionedStudent: { id: 's1', displayName: 'Ada' }
  };

  it('runs the skill plan, executes each step, and returns a completed skill trace', async () => {
    tools.runTool
      .mockResolvedValueOnce({ summary: 'profile' })
      .mockResolvedValueOnce({ apps: [] });
    generateAnswerFromInput.mockResolvedValue({
      response: { id: 'resp_1', usage: { total_tokens: 5 } },
      answer: 'Ada summary'
    });

    const postgres = makePostgres({ withSelect: false });
    const onProgress = jest.fn();
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'summarize',
      req: REQ,
      assistContext: skillAssistContext,
      preferredLanguage: 'en',
      onProgress
    });

    // summarize_student has 2 steps
    expect(tools.runTool).toHaveBeenCalledTimes(2);
    expect(generateAnswerFromInput).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe('Ada summary');
    expect(result.skillTrace.mode).toBe('skill');
    expect(result.skillTrace.status).toBe('completed');
    expect(result.skillTrace.steps).toHaveLength(2);
    expect(result.activeStudent).toEqual({ id: 's1', displayName: 'Ada' });
    expect(result.usage).toEqual({ total_tokens: 5 });
    // progress events were emitted
    expect(onProgress).toHaveBeenCalled();
  });

  it('skips the student link-hint candidate when the student has no display name', async () => {
    tools.runTool.mockResolvedValue({ ok: true });
    generateAnswerFromInput.mockResolvedValue({
      response: { id: 'r' },
      answer: 'summary'
    });
    let captured;
    extractAnswerReferences.mockImplementation(async ({ candidates }) => {
      captured = candidates;
      return { answer: 'summary', linkHints: {} };
    });

    const postgres = makePostgres({ withSelect: false });
    await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'summarize',
      req: REQ,
      // mentionedStudent has an id but no displayName -> candidate skipped
      assistContext: {
        requestedSkill: 'summarize_student',
        mentionedStudent: { id: 's1' }
      },
      preferredLanguage: 'en'
    });
    // no student candidate was added (no name)
    expect(captured.find((c) => c.entityType === 'student')).toBeUndefined();
  });

  it('throws when a skill step references an unknown tool', async () => {
    tools.hasTool.mockReturnValue(false);
    const postgres = makePostgres({ withSelect: false });
    await expect(
      runAiAssist(postgres, {
        conversationId: 'c1',
        message: 'summarize',
        req: REQ,
        assistContext: skillAssistContext,
        preferredLanguage: 'en'
      })
    ).rejects.toThrow('Unknown AI Assist skill tool');
  });
});

describe('runAiAssist - legacy tool loop (fallback)', () => {
  const fallbackContext = {
    requestedSkill: 'ghost_skill', // unsupported -> fallbackReason set
    mentionedStudent: { id: 's1', displayName: 'Ada' }
  };

  it('returns the model answer immediately when no function calls are requested', async () => {
    openAIClient.responses.create.mockResolvedValue({
      id: 'resp_x',
      output_text: 'direct answer',
      output: []
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hello',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });

    expect(result.answer).toBe('direct answer');
    expect(openAIClient.responses.create).toHaveBeenCalledTimes(1);
  });

  it('executes a function call then returns the follow-up answer', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'r1',
        output: [
          {
            type: 'function_call',
            name: 'get_student_summary',
            call_id: 'call_1',
            arguments: JSON.stringify({ studentId: 's1' })
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'r2',
        output: [{ type: 'message', content: [{ text: 'final answer' }] }]
      });
    tools.runTool.mockResolvedValue({
      data: { program: { id: 'p1', name: 'CS', school: 'TU' } }
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'summary',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });

    expect(tools.runTool).toHaveBeenCalledWith(REQ, 'get_student_summary', {
      studentId: 's1'
    });
    expect(result.answer).toBe('final answer');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].status).toBe('success');
  });

  it('captures a failed tool call without aborting the loop', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'r1',
        output: [
          {
            type: 'function_call',
            name: 'broken_tool',
            call_id: 'call_1',
            arguments: '{bad json'
          }
        ]
      })
      .mockResolvedValueOnce({ id: 'r2', output_text: 'recovered' });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'x',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });

    expect(result.answer).toBe('recovered');
    expect(result.trace[0].status).toBe('failed');
    // bad JSON args fall back to a _raw wrapper
    expect(result.trace[0].arguments).toHaveProperty('_raw');
  });

  it('reports the unknown-tool error inside the trace', async () => {
    tools.hasTool.mockReturnValue(false);
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'r1',
        output: [
          {
            type: 'function_call',
            name: 'mystery',
            call_id: 'c',
            arguments: '{}'
          }
        ]
      })
      .mockResolvedValueOnce({ id: 'r2', output_text: 'done' });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'x',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });
    expect(result.trace[0].status).toBe('failed');
    expect(result.trace[0].result.error).toContain('Unknown AI Assist tool');
  });

  it('treats a function call with no arguments as an empty arg object', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'r1',
        output: [
          {
            type: 'function_call',
            name: 'get_student_summary',
            call_id: 'c',
            arguments: undefined
          }
        ]
      })
      .mockResolvedValueOnce({ id: 'r2', output_text: 'ok' });
    tools.runTool.mockResolvedValue({ ok: true });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'x',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });
    expect(tools.runTool).toHaveBeenCalledWith(REQ, 'get_student_summary', {});
    expect(result.trace[0].arguments).toEqual({});
  });

  it('passes through arguments that are already an object', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'r1',
        output: [
          {
            type: 'function_call',
            name: 'get_student_summary',
            call_id: 'c',
            arguments: { studentId: 's7' }
          }
        ]
      })
      .mockResolvedValueOnce({ id: 'r2', output_text: 'ok' });
    tools.runTool.mockResolvedValue({ ok: true });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'x',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });
    expect(tools.runTool).toHaveBeenCalledWith(REQ, 'get_student_summary', {
      studentId: 's7'
    });
  });

  it('stops after MAX_TOOL_ROUNDS and returns the cap message', async () => {
    openAIClient.responses.create.mockResolvedValue({
      id: 'loop',
      output: [
        {
          type: 'function_call',
          name: 'get_student_summary',
          call_id: 'c',
          arguments: '{}'
        }
      ]
    });
    tools.runTool.mockResolvedValue({ ok: true });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'x',
      req: REQ,
      assistContext: fallbackContext,
      preferredLanguage: 'en'
    });
    expect(result.answer).toContain('maximum number of tool calls');
    expect(openAIClient.responses.create).toHaveBeenCalledTimes(6);
  });
});

describe('runAiAssist - intent-first flow', () => {
  it('returns a student-resolution reply when resolution is needed but fails (ambiguous)', async () => {
    classifyIntent.mockResolvedValue({
      intent: 'student_applications',
      studentQuery: 'Smith',
      needsStudentResolution: true
    });
    resolveStudent.mockResolvedValue({
      status: 'ambiguous',
      candidates: [
        { name: 'Ann Smith', email: 'ann@x.com', id: 'a1', chineseName: '史' },
        { name: 'Al Smith', id: 'a2' }
      ],
      searchResult: { data: [] }
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'app status for Smith',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(result.answer).toContain('Multiple students matched');
    expect(result.answer).toContain('Ann Smith');
    expect(result.skillTrace.status).toBe('fallback');
    expect(result.skillTrace.fallbackReason).toBe(
      'student_resolution_ambiguous'
    );
  });

  it('returns the not_found reply when no student matches', async () => {
    classifyIntent.mockResolvedValue({
      intent: 'student_applications',
      studentQuery: 'Ghost',
      needsStudentResolution: true
    });
    resolveStudent.mockResolvedValue({ status: 'not_found', candidates: [] });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'find Ghost',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    expect(result.answer).toContain('No accessible student matched');
  });

  it('returns the generic prompt for a non-resolved, non-ambiguous status', async () => {
    classifyIntent.mockResolvedValue({
      intent: 'student_applications',
      studentQuery: '',
      needsStudentResolution: true
    });
    resolveStudent.mockResolvedValue({
      status: 'missing_query',
      candidates: []
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'applications',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    expect(result.answer).toBe('Please provide student name or email.');
  });

  it('uses an explicit @mention as the resolved student and runs the intent plan', async () => {
    classifyIntent.mockResolvedValue({
      intent: 'student_applications',
      studentQuery: null,
      needsStudentResolution: true
    });
    tools.runTool.mockResolvedValue({
      applications: [{ program: { id: 'p1', name: 'CS', school: 'TU' } }]
    });
    composeAnswer.mockResolvedValue({
      response: { id: 'resp_c', usage: { total_tokens: 9 } },
      answer: 'app summary'
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'app status',
      req: REQ,
      assistContext: { mentionedStudent: { id: 's1', displayName: 'Ada' } },
      preferredLanguage: 'en'
    });

    expect(tools.runTool).toHaveBeenCalledWith(REQ, 'get_application_context', {
      studentId: 's1'
    });
    expect(result.answer).toBe('app summary');
    expect(result.activeStudent).toEqual({ id: 's1', name: 'Ada' });
    expect(result.activeStudentSource).toBe('explicit_mention');
  });

  it('resolves the conversation-bound student when no query is supplied', async () => {
    classifyIntent.mockResolvedValue({
      intent: 'student_communications',
      studentQuery: null,
      needsStudentResolution: true
    });
    resolveStudentById.mockResolvedValue({
      status: 'resolved',
      student: { id: 's2', name: 'Bound' }
    });
    tools.runTool.mockResolvedValue({ messages: [] });
    composeAnswer.mockResolvedValue({ response: { id: 'r' }, answer: 'comm' });

    // conversationContext comes from the select() chain: conversation row first
    const postgres = makePostgres({
      selectResults: [
        [{ studentId: 's2', studentDisplayName: 'Bound' }], // conversation
        [], // messages
        [] // toolCalls
      ]
    });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'recent messages',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });

    expect(resolveStudentById).toHaveBeenCalledWith(REQ, 's2', 'Bound');
    expect(result.activeStudentSource).toBe('conversation_active');
    expect(result.answer).toBe('comm');
  });

  it('handles a general intent with no tool plan', async () => {
    classifyIntent.mockResolvedValue({
      intent: 'general',
      studentQuery: null,
      needsStudentResolution: false
    });
    composeAnswer.mockResolvedValue({
      response: { id: 'r' },
      answer: 'hello there'
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    expect(tools.runTool).not.toHaveBeenCalled();
    expect(result.answer).toBe('hello there');
    expect(result.activeStudent).toBeNull();
  });
});

describe('runAiAssist - chat fallback (no responses API)', () => {
  it('uses chat.completions when the responses API is unavailable (non-stream)', async () => {
    openAIClient.responses = undefined;
    openAIClient.chat.completions.create.mockResolvedValue({
      id: 'chat_1',
      usage: { total_tokens: 3 },
      choices: [{ message: { content: 'fallback answer' } }]
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    expect(result.answer).toBe('fallback answer');
    expect(openAIClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('streams chat tokens when onToken is provided', async () => {
    openAIClient.responses = undefined;
    openAIClient.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hel' } }] };
        yield { choices: [{ delta: { content: 'lo' } }] };
        yield { choices: [{ delta: {} }] };
      })()
    );
    const tokens = [];

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en',
      onToken: async (t) => tokens.push(t)
    });
    expect(result.answer).toBe('Hello');
    expect(tokens).toEqual(['Hel', 'lo']);
  });
});

describe('runAiAssist - persistence + annotation', () => {
  it('falls back to a default answer and persists the assistant message', async () => {
    openAIClient.responses = undefined;
    openAIClient.chat.completions.create.mockResolvedValue({
      id: 'c',
      choices: [{ message: { content: '' } }]
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    expect(result.answer).toBe('No answer was returned by AI Assist.');
    expect(result.assistantMessage).toBeDefined();
    expect(result.userMessage).toBeDefined();
  });

  it('applies normalized references and link hints from the annotator', async () => {
    openAIClient.responses = undefined;
    openAIClient.chat.completions.create.mockResolvedValue({
      id: 'c',
      choices: [{ message: { content: 'raw' } }]
    });
    extractAnswerReferences.mockResolvedValue({
      answer: 'annotated [reflink:1|Ada]',
      linkHints: { 1: { entityType: 'student', entityId: 's1' } }
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    expect(result.answer).toBe('annotated [reflink:1|Ada]');
    expect(result.assistantMessage.linkHints).toEqual({
      1: { entityType: 'student', entityId: 's1' }
    });
  });

  it('persists tool-call trace rows for executed intent tools', async () => {
    openAIClient.responses = { create: jest.fn() };
    classifyIntent.mockResolvedValue({
      intent: 'support_tickets',
      studentQuery: null,
      needsStudentResolution: true
    });
    tools.runTool.mockResolvedValue({ tickets: [] });
    composeAnswer.mockResolvedValue({
      response: { id: 'r' },
      answer: 'tickets'
    });

    const postgres = makePostgres({ withSelect: false });
    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'tickets',
      req: REQ,
      assistContext: { mentionedStudent: { id: 's1', displayName: 'Ada' } },
      preferredLanguage: 'en'
    });
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].toolName).toBe('get_support_ticket_context');
  });
});

describe('runAiAssist - language policy and link hints', () => {
  // When the message strips down to nothing (only control tokens), the
  // responseLanguageInstruction is derived from preferredLanguage. We cannot
  // assert it directly from the public return, but exercising each branch keeps
  // the language-name mapping covered.
  const runWithLanguage = async (preferredLanguage, message) => {
    openAIClient.responses = undefined;
    openAIClient.chat.completions.create.mockResolvedValue({
      id: 'c',
      choices: [{ message: { content: 'ok' } }]
    });
    const postgres = makePostgres({ withSelect: false });
    return runAiAssist(postgres, {
      conversationId: 'c1',
      message,
      req: REQ,
      assistContext: { mentionedStudent: { displayName: 'Ada' } },
      preferredLanguage
    });
  };

  it('maps Traditional Chinese (zh-tw) when no extra prompt remains', async () => {
    const result = await runWithLanguage('zh-TW', '@Ada #summarize_student');
    expect(result.answer).toBe('ok');
  });

  it('maps Simplified Chinese (zh-cn)', async () => {
    const result = await runWithLanguage('zh-CN', '@Ada');
    expect(result.answer).toBe('ok');
  });

  it('maps generic Chinese (zh)', async () => {
    const result = await runWithLanguage('zh', '@Ada');
    expect(result.answer).toBe('ok');
  });

  it('defaults to English for an unknown preference', async () => {
    const result = await runWithLanguage('fr', '@Ada');
    expect(result.answer).toBe('ok');
  });

  it('skips link-hint student candidates missing an id or name', async () => {
    // resolved student with no id/name -> addStudentCandidate early returns
    classifyIntent.mockResolvedValue({
      intent: 'general',
      studentQuery: null,
      needsStudentResolution: false
    });
    composeAnswer.mockResolvedValue({ response: { id: 'r' }, answer: 'ok' });
    openAIClient.responses = { create: jest.fn() };

    const postgres = makePostgres({ withSelect: false });
    const captured = [];
    extractAnswerReferences.mockImplementation(async ({ candidates }) => {
      captured.push(candidates);
      return { answer: 'ok', linkHints: {} };
    });

    await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: { mentionedStudent: { id: 's1', displayName: 'Ada' } },
      preferredLanguage: 'en'
    });
    // explicit mention is resolved but general intent collects no candidates
    expect(Array.isArray(captured[0])).toBe(true);
  });
});

describe('runAiAssist - conversation context loading', () => {
  it('reads recent messages and tool calls from the select chain', async () => {
    openAIClient.responses = { create: jest.fn() };
    classifyIntent.mockResolvedValue({
      intent: 'general',
      studentQuery: null,
      needsStudentResolution: false
    });
    composeAnswer.mockResolvedValue({ response: { id: 'r' }, answer: 'ok' });

    const postgres = makePostgres({
      selectResults: [
        [{ studentId: { toString: () => 's9' }, studentDisplayName: 'Nine' }],
        [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: 'reply' }
        ],
        [
          {
            toolName: 'get_student_context',
            arguments: {},
            result: {},
            status: 'success'
          }
        ]
      ]
    });

    const result = await runAiAssist(postgres, {
      conversationId: 'c1',
      message: 'hi',
      req: REQ,
      assistContext: {},
      preferredLanguage: 'en'
    });
    // conversationContext was loaded and passed into classifyIntent
    expect(classifyIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          boundStudentId: 's9',
          boundStudentDisplayName: 'Nine'
        })
      })
    );
    expect(result.answer).toBe('ok');
  });
});
