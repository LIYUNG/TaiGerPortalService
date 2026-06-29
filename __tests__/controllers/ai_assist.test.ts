// Controller UNIT test for controllers/ai_assist.
//
// AI Assist is a Postgres/Drizzle + orchestrator controller. We isolate the
// boundary: mock getPostgresDb (a chainable Drizzle double), the orchestrator,
// the tool/studentAccess helpers, StudentService, the OpenAI client, and the
// logger. Each handler is invoked DIRECTLY as (req, res, next). No supertest,
// no route, no middleware, no DB.
//
// The database mock must be declared before the controller is required because
// queueAiTitleRefinement references getPostgresDb lazily but the module pulls
// it in at evaluation time.

jest.mock('../../database', () => ({
  getPostgresDb: jest.fn()
}));

jest.mock('../../services/ai-assist/orchestrator', () => ({
  runAiAssist: jest.fn()
}));

jest.mock('../../services/ai-assist/tools', () => ({
  normalizeStudentPickerRow: jest.fn((s) => ({ id: s._id || s.id, ...s })),
  requireAccessibleStudent: jest.fn(),
  searchAccessibleStudents: jest.fn()
}));

jest.mock('../../services/ai-assist/studentAccess', () => ({
  getAccessibleStudentFilter: jest.fn()
}));

jest.mock('../../services/ai-assist/postgresRetry', () => ({
  withPostgresRetry: jest.fn((op) => op())
}));

jest.mock('../../services/students', () => ({
  findStudentsSelect: jest.fn()
}));

jest.mock('../../services/permissions', () => ({
  decrementTaigerAiQuota: jest.fn()
}));

jest.mock('../../services/communications', () => ({
  getRecentByStudentId: jest.fn()
}));

jest.mock('../../services/openai', () => ({
  openAIClient: { responses: { create: jest.fn() } },
  OpenAiModel: { GPT_5_4_nano: 'gpt-5.4-nano' }
}));

jest.mock('../../services/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
}));

import { mockReq, mockRes } from '../helpers/httpMocks';
import { getPostgresDb } from '../../database';
import orchestrator from '../../services/ai-assist/orchestrator';
import {
  requireAccessibleStudent,
  searchAccessibleStudents
} from '../../services/ai-assist/tools';
import { getAccessibleStudentFilter } from '../../services/ai-assist/studentAccess';
import StudentService from '../../services/students';
import { openAIClient } from '../../services/openai';
import logger from '../../services/logger';
import PermissionService from '../../services/permissions';
import CommunicationService from '../../services/communications';
import controller from '../../controllers/ai_assist';

const USER = { _id: { toString: () => 'user_1' }, role: 'Agent' };

// Chainable Drizzle double. Awaiting any select chain resolves to
// `state.selectResult`; insert/update .returning() resolves to
// `state.returningResult`. transaction(cb) runs cb with the same double.
const makeDb = () => {
  // selectQueue lets a handler that issues several selects (e.g.
  // getConversation: owner row, then messages, then trace) get a distinct
  // result per await. When the queue is exhausted it falls back to
  // selectResult.
  const state = { selectResult: [], returningResult: [], selectQueue: null };
  const builder = {};
  const resolveSelect = () => {
    if (Array.isArray(state.selectQueue) && state.selectQueue.length) {
      return state.selectQueue.shift();
    }
    return state.selectResult;
  };
  builder.then = (resolve, reject) =>
    Promise.resolve(resolveSelect()).then(resolve, reject);

  [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'values',
    'update',
    'set'
  ].forEach((m) => {
    builder[m] = jest.fn().mockReturnValue(builder);
  });
  builder.returning = jest
    .fn()
    .mockImplementation(() => Promise.resolve(state.returningResult));

  const db = {
    ...builder,
    then: builder.then,
    transaction: jest.fn(async (cb) => cb(db)),
    _setSelect: (v) => {
      state.selectResult = v;
      return db;
    },
    _setSelectQueue: (v) => {
      state.selectQueue = v;
      return db;
    },
    _setReturning: (v) => {
      state.returningResult = v;
      return db;
    }
  };
  return db;
};

let db;

beforeEach(() => {
  jest.clearAllMocks();
  db = makeDb();
  getPostgresDb.mockReturnValue(db);
  // Default: no recent messages -> reply-draft sensitivity check resolves false.
  CommunicationService.getRecentByStudentId.mockResolvedValue([]);
  delete process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
});

// ---------------------------------------------------------------------------
// createConversation
// ---------------------------------------------------------------------------
describe('createConversation', () => {
  it('inserts a conversation and returns 201', async () => {
    db._setReturning([{ id: 'conv_1', title: 'New AI Assist conversation' }]);
    const req = mockReq({ user: USER, body: {} });
    const res = mockRes();

    await controller.createConversation(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { id: 'conv_1', title: 'New AI Assist conversation' }
    });
  });

  it('honors a manually provided title', async () => {
    db._setReturning([{ id: 'conv_1', title: 'My title' }]);
    const req = mockReq({ user: USER, body: { title: '  My title  ' } });
    const res = mockRes();

    await controller.createConversation(req, res, jest.fn());

    const insertedValues = db.values.mock.calls[0][0];
    expect(insertedValues.title).toBe('My title');
    expect(insertedValues.titleUpdatedByUser).toBe(true);
    expect(insertedValues.titleAutoGenerated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------
describe('listConversations', () => {
  it('returns the active conversations for the owner', async () => {
    db._setSelect([{ id: 'c1' }, { id: 'c2' }]);
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listConversations(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'c1' }, { id: 'c2' }]
    });
  });
});

// ---------------------------------------------------------------------------
// listMyStudents / searchStudents
// ---------------------------------------------------------------------------
describe('listMyStudents', () => {
  it('returns accessible students mapped to picker rows', async () => {
    getAccessibleStudentFilter.mockResolvedValue({ agents: 'user_1' });
    StudentService.findStudentsSelect.mockResolvedValue([{ _id: 's1' }]);
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listMyStudents(req, res, jest.fn());

    expect(getAccessibleStudentFilter).toHaveBeenCalledWith(req);
    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      { agents: 'user_1' },
      expect.any(String),
      25
    );
    expect(res.send.mock.calls[0][0].data[0].id).toBe('s1');
  });

  it('propagates a 403 from the access filter to next()', async () => {
    const err = new Error('Permission denied');
    getAccessibleStudentFilter.mockRejectedValue(err);
    const next = jest.fn();

    await controller.listMyStudents(mockReq({ user: USER }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('searchStudents', () => {
  it('forwards query/limit to searchAccessibleStudents', async () => {
    searchAccessibleStudents.mockResolvedValue({ data: [{ id: 's1' }] });
    const req = mockReq({ user: USER, query: { q: 'Ada', limit: '5' } });
    const res = mockRes();

    await controller.searchStudents(req, res, jest.fn());

    expect(searchAccessibleStudents).toHaveBeenCalledWith(req, {
      query: 'Ada',
      limit: '5'
    });
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 's1' }]
    });
  });
});

// ---------------------------------------------------------------------------
// listRecentStudents
// ---------------------------------------------------------------------------
describe('listRecentStudents', () => {
  it('returns an empty list when there are no conversations with students', async () => {
    db._setSelect([]);
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listRecentStudents(req, res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
    expect(StudentService.findStudentsSelect).not.toHaveBeenCalled();
  });

  it('dedupes student ids and joins picker rows + conversation id', async () => {
    db._setSelect([
      { id: 'conv_a', studentId: 's1', studentDisplayName: 'Ada' },
      { id: 'conv_b', studentId: 's1' }, // dupe, ignored
      { id: 'conv_c', studentId: 's2' }
    ]);
    getAccessibleStudentFilter.mockResolvedValue({ agents: 'user_1' });
    StudentService.findStudentsSelect.mockResolvedValue([
      { _id: { toString: () => 's1' } },
      { _id: { toString: () => 's2' } }
    ]);
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listRecentStudents(req, res, jest.fn());

    const data = res.send.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      conversationId: 'conv_a',
      studentDisplayName: 'Ada'
    });
    expect(data[1]).toMatchObject({ conversationId: 'conv_c' });
  });

  it('drops recent students that are no longer accessible', async () => {
    db._setSelect([{ id: 'conv_a', studentId: 's1' }]);
    getAccessibleStudentFilter.mockResolvedValue({});
    StudentService.findStudentsSelect.mockResolvedValue([]); // none accessible
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listRecentStudents(req, res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

// ---------------------------------------------------------------------------
// getConversation / archiveConversation / updateConversation
// ---------------------------------------------------------------------------
describe('getConversation', () => {
  it('returns the conversation with messages and trace', async () => {
    // 1st select -> owner row; subsequent selects -> messages, trace
    db._setSelectQueue([
      [{ id: 'conv_1' }], // requireActiveConversationOwner
      [{ id: 'm1' }], // messages
      [{ id: 't1' }] // trace
    ]);
    const req = mockReq({ user: USER, params: { conversationId: 'conv_1' } });
    const res = mockRes();

    await controller.getConversation(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data).toEqual({
      conversation: { id: 'conv_1' },
      messages: [{ id: 'm1' }],
      trace: [{ id: 't1' }]
    });
  });

  it('forwards a 404 when the conversation is not owned/active', async () => {
    db._setSelect([]); // no owner row
    const next = jest.fn();
    const req = mockReq({ user: USER, params: { conversationId: 'nope' } });

    await controller.getConversation(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'AI Assist conversation not found'
      })
    );
  });
});

describe('archiveConversation', () => {
  it('archives an owned active conversation', async () => {
    db._setReturning([{ id: 'conv_1', status: 'archived' }]);
    const req = mockReq({ user: USER, params: { conversationId: 'conv_1' } });
    const res = mockRes();

    await controller.archiveConversation(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.set.mock.calls[0][0].status).toBe('archived');
  });

  it('forwards 404 when nothing was updated', async () => {
    db._setReturning([]);
    const next = jest.fn();

    await controller.archiveConversation(
      mockReq({ user: USER, params: { conversationId: 'x' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('updateConversation', () => {
  it('rejects a blank title with 400', async () => {
    const next = jest.fn();

    await controller.updateConversation(
      mockReq({
        user: USER,
        params: { conversationId: 'c' },
        body: { title: '  ' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Conversation title is required'
      })
    );
  });

  it('persists a user-set title with the manual flags', async () => {
    db._setReturning([{ id: 'c', title: 'New' }]);
    const req = mockReq({
      user: USER,
      params: { conversationId: 'c' },
      body: { title: '  New  ' }
    });
    const res = mockRes();

    await controller.updateConversation(req, res, jest.fn());

    const values = db.set.mock.calls[0][0];
    expect(values).toMatchObject({
      title: 'New',
      titleAutoGenerated: false,
      titleUpdatedByUser: true
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// sendMessage (non-streaming)
// ---------------------------------------------------------------------------
describe('sendMessage', () => {
  const baseReq = (overrides = {}) =>
    mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'hello' },
      ...overrides
    });

  it('rejects a missing message with 400', async () => {
    const next = jest.fn();
    await controller.sendMessage(baseReq({ body: {} }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'message is required'
      })
    );
  });

  it('runs the orchestrator and returns 200 with the assistant result', async () => {
    db._setSelect([{ id: 'conv_1', title: 'New AI Assist conversation' }]);
    db._setReturning([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'hi',
      activeStudent: { id: 's1', displayName: 'Ada' },
      assistantMessage: { linkHints: {} }
    });
    const req = baseReq();
    const res = mockRes();

    await controller.sendMessage(req, res, jest.fn());

    expect(orchestrator.runAiAssist).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data.answer).toBe('hi');
  });

  it('maps an OpenAI quota error to a 503 client response', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    const quotaError = Object.assign(new Error('insufficient_quota'), {
      status: 429,
      code: 'insufficient_quota'
    });
    orchestrator.runAiAssist.mockRejectedValue(quotaError);
    const req = baseReq();
    const res = mockRes();

    await controller.sendMessage(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.send.mock.calls[0][0]).toEqual({
      success: false,
      message: 'AI Assist is temporarily unavailable. Please try again.'
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('maps an invalid API key error to a 502 client response', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    const keyError = Object.assign(new Error('Incorrect API key provided'), {
      status: 401,
      code: 'invalid_api_key'
    });
    orchestrator.runAiAssist.mockRejectedValue(keyError);
    const res = mockRes();

    await controller.sendMessage(baseReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('rethrows a non-OpenAI error to next()', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    const plain = new Error('boom');
    orchestrator.runAiAssist.mockRejectedValue(plain);
    const next = jest.fn();

    await controller.sendMessage(baseReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(plain);
  });

  it('maps a generic OpenAI failure (neither key nor quota) to 502', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    // has an OpenAI-shaped code but is not invalid-key / quota -> generic branch
    orchestrator.runAiAssist.mockRejectedValue(
      Object.assign(new Error('server_error'), {
        status: 500,
        code: 'server_error'
      })
    );
    const res = mockRes();

    await controller.sendMessage(baseReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.send.mock.calls[0][0].message).toBe(
      'AI Assist is temporarily unavailable. Please try again.'
    );
  });

  it('validates an @mentioned student before running', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'ok',
      assistantMessage: { linkHints: {} }
    });
    const req = baseReq({
      body: {
        message: 'go',
        assistContext: { mentionedStudent: { id: 's1', displayName: 'Ada' } }
      }
    });

    await controller.sendMessage(req, mockRes(), jest.fn());

    expect(requireAccessibleStudent).toHaveBeenCalledWith(req, 's1');
  });

  it('forwards analysisMode to the orchestrator for student deep-dives', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'ok',
      assistantMessage: { linkHints: {} }
    });
    const req = baseReq({
      body: {
        message: 'analyze',
        assistContext: {
          mentionedStudent: { id: 's1', displayName: 'Ada' },
          analysisMode: true
        }
      }
    });

    await controller.sendMessage(req, mockRes(), jest.fn());

    expect(orchestrator.runAiAssist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assistContext: expect.objectContaining({ analysisMode: true })
      })
    );
  });

  it('defaults analysisMode to false when a context omits it', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'ok',
      assistantMessage: { linkHints: {} }
    });
    const req = baseReq({
      body: {
        message: 'go',
        assistContext: { mentionedStudent: { id: 's1', displayName: 'Ada' } }
      }
    });

    await controller.sendMessage(req, mockRes(), jest.fn());

    expect(orchestrator.runAiAssist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assistContext: expect.objectContaining({ analysisMode: false })
      })
    );
  });
});

// ---------------------------------------------------------------------------
// sendMessage (streaming) and sendFirstMessage
// ---------------------------------------------------------------------------
describe('sendMessage - streaming', () => {
  it('initializes SSE and streams a final result', async () => {
    db._setSelect([{ id: 'conv_1', title: 'New AI Assist conversation' }]);
    db._setReturning([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockImplementation(async (tx, opts) => {
      await opts.onProgress({ type: 'status', phase: 'start' });
      await opts.onToken('tok');
      return {
        answer: 'streamed',
        assistantMessage: {
          linkHints: { 1: { entityType: 'student', entityId: 's1' } }
        }
      };
    });
    const req = mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'hi' },
      query: { stream: '1' }
    });
    const res = mockRes();
    res.write = jest.fn();
    res.setHeader = jest.fn();
    res.flushHeaders = jest.fn();

    await controller.sendMessage(req, res, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream'
    );
    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('event: final');
    expect(written).toContain('event: done');
    expect(res.end).toHaveBeenCalled();
  });

  it('writes a mapped error event when the orchestrator fails with a quota error', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockRejectedValue(
      Object.assign(new Error('rate limit'), { status: 429 })
    );
    const req = mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'hi' },
      headers: { accept: 'text/event-stream' }
    });
    const res = mockRes();
    res.write = jest.fn();
    res.setHeader = jest.fn();

    await controller.sendMessage(req, res, jest.fn());

    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('event: error');
    expect(res.end).toHaveBeenCalled();
  });

  it('writes a raw error event for a non-OpenAI failure', async () => {
    db._setSelect([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockRejectedValue(new Error('weird'));
    const req = mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'hi' },
      query: { stream: 'true' }
    });
    const res = mockRes();
    res.write = jest.fn();
    res.setHeader = jest.fn();

    await controller.sendMessage(req, res, jest.fn());

    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('weird');
  });
});

describe('sendFirstMessage', () => {
  it('rejects a missing message with 400', async () => {
    const next = jest.fn();
    await controller.sendFirstMessage(
      mockReq({ user: USER, body: {} }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it('creates a conversation, runs the orchestrator, and returns 201', async () => {
    db._setSelect([{ id: 'conv_new' }]);
    db._setReturning([{ id: 'conv_new', title: 'New AI Assist conversation' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'first',
      activeStudent: { id: 's1', displayName: 'Ada' },
      assistantMessage: { linkHints: {} }
    });
    const req = mockReq({ user: USER, body: { message: 'hello' } });
    const res = mockRes();

    await controller.sendFirstMessage(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send.mock.calls[0][0].data.answer).toBe('first');
    expect(res.send.mock.calls[0][0].data.conversation).toBeDefined();
  });

  it('maps an OpenAI failure to the configured status code', async () => {
    db._setSelect([{ id: 'conv_new' }]);
    db._setReturning([{ id: 'conv_new' }]);
    orchestrator.runAiAssist.mockRejectedValue(
      Object.assign(new Error('api key not provided'), {})
    );
    const res = mockRes();

    await controller.sendFirstMessage(
      mockReq({ user: USER, body: { message: 'hi' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('rethrows a non-OpenAI error to next()', async () => {
    db._setSelect([{ id: 'conv_new' }]);
    db._setReturning([{ id: 'conv_new' }]);
    const plain = new Error('nope');
    orchestrator.runAiAssist.mockRejectedValue(plain);
    const next = jest.fn();

    await controller.sendFirstMessage(
      mockReq({ user: USER, body: { message: 'hi' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(plain);
  });

  it('streams a first-message result over SSE (with progress + token events)', async () => {
    db._setSelect([{ id: 'conv_new' }]);
    db._setReturning([{ id: 'conv_new', title: 'New AI Assist conversation' }]);
    orchestrator.runAiAssist.mockImplementation(async (tx, opts) => {
      await opts.onProgress({ type: 'status', phase: 'start' });
      await opts.onToken('tok');
      return { answer: 'streamed first', assistantMessage: { linkHints: {} } };
    });
    const req = mockReq({
      user: USER,
      body: { message: 'hi' },
      query: { stream: '1' }
    });
    const res = mockRes();
    res.write = jest.fn();
    res.setHeader = jest.fn();
    res.flushHeaders = jest.fn();

    await controller.sendFirstMessage(req, res, jest.fn());

    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('event: progress');
    expect(written).toContain('event: token');
    expect(written).toContain('event: final');
    expect(res.end).toHaveBeenCalled();
  });

  it('writes a mapped error event when streaming fails with an OpenAI error', async () => {
    db._setSelect([{ id: 'conv_new' }]);
    db._setReturning([{ id: 'conv_new' }]);
    orchestrator.runAiAssist.mockRejectedValue(
      Object.assign(new Error('insufficient_quota'), { status: 429 })
    );
    const req = mockReq({
      user: USER,
      body: { message: 'hi' },
      headers: { accept: 'text/event-stream' }
    });
    const res = mockRes();
    res.write = jest.fn();
    res.setHeader = jest.fn();

    await controller.sendFirstMessage(req, res, jest.fn());

    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('event: error');
    expect(logger.warn).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('writes a raw error event when streaming fails with a non-OpenAI error', async () => {
    db._setSelect([{ id: 'conv_new' }]);
    db._setReturning([{ id: 'conv_new' }]);
    orchestrator.runAiAssist.mockRejectedValue(new Error('disk full'));
    const req = mockReq({
      user: USER,
      body: { message: 'hi' },
      query: { stream: 'true' }
    });
    const res = mockRes();
    res.write = jest.fn();
    res.setHeader = jest.fn();

    await controller.sendFirstMessage(req, res, jest.fn());

    const written = res.write.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('disk full');
  });
});

// ---------------------------------------------------------------------------
// Auto-title generation branches (driven through sendMessage)
// ---------------------------------------------------------------------------
describe('auto-title generation', () => {
  const runSend = async (conversationRow, assistantResult, body) => {
    db._setSelectQueue([[conversationRow]]); // requireActiveConversationOwner
    db._setReturning([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue(assistantResult);
    const req = mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'hello there', ...body }
    });
    const res = mockRes();
    await controller.sendMessage(req, res, jest.fn());
    return res;
  };

  it('builds a "<student> · <skill>" title when both are present', async () => {
    await runSend(
      { id: 'conv_1', title: 'New AI Assist conversation' },
      {
        answer: 'a',
        activeStudent: { id: 's1', displayName: 'Ada' },
        skillTrace: { requestedSkill: 'summarize_student' },
        assistantMessage: { linkHints: {} }
      },
      { assistContext: { requestedSkill: 'summarize_student' } }
    );
    // update .set() received a title combining student and skill label
    const setValues = db.set.mock.calls.find((c) => c[0].title)?.[0];
    expect(setValues.title).toBe('Ada · Student summary');
    expect(setValues.titleAutoGenerated).toBe(true);
  });

  it('uses the skill label alone when there is no student', async () => {
    await runSend(
      { id: 'conv_1', title: 'New AI Assist conversation' },
      {
        answer: 'a',
        skillTrace: { requestedSkill: 'identify_risk' },
        assistantMessage: { linkHints: {} }
      },
      { assistContext: { requestedSkill: 'identify_risk' } }
    );
    const setValues = db.set.mock.calls.find((c) => c[0].title)?.[0];
    expect(setValues.title).toBe('Application risk check');
  });

  it('falls back to the plain message when no student or skill applies', async () => {
    await runSend(
      { id: 'conv_1', title: 'New AI Assist conversation' },
      { answer: 'a', assistantMessage: { linkHints: {} } }
    );
    const setValues = db.set.mock.calls.find((c) => c[0].title)?.[0];
    expect(setValues.title).toBe('hello there');
  });

  it('does not auto-generate a title when the user already set one', async () => {
    await runSend(
      { id: 'conv_1', title: 'Mine', titleUpdatedByUser: true },
      { answer: 'a', assistantMessage: { linkHints: {} } }
    );
    const setValues = db.set.mock.calls.find((c) => c[0].title);
    expect(setValues).toBeUndefined();
  });

  it('does not auto-generate when titleAutoGenerated is explicitly false', async () => {
    await runSend(
      { id: 'conv_1', title: 'Fixed', titleAutoGenerated: false },
      { answer: 'a', assistantMessage: { linkHints: {} } }
    );
    expect(db.set.mock.calls.find((c) => c[0].title)).toBeUndefined();
  });

  it('does not auto-generate when an unflagged title already differs from default', async () => {
    await runSend(
      { id: 'conv_1', title: 'Existing custom title' },
      { answer: 'a', assistantMessage: { linkHints: {} } }
    );
    expect(db.set.mock.calls.find((c) => c[0].title)).toBeUndefined();
  });

  it('persists the active student onto the conversation', async () => {
    await runSend(
      { id: 'conv_1', title: 'New AI Assist conversation' },
      {
        answer: 'a',
        activeStudent: { id: 's1', name: 'Ada Fallback' },
        assistantMessage: { linkHints: {} }
      }
    );
    const setValues = db.set.mock.calls.find((c) => c[0].studentId)?.[0];
    expect(setValues.studentId).toBe('s1');
    expect(setValues.studentDisplayName).toBe('Ada Fallback');
  });
});

// ---------------------------------------------------------------------------
// queueAiTitleRefinement (only fires outside NODE_ENV=test)
// ---------------------------------------------------------------------------
describe('queueAiTitleRefinement (background refinement)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = 'test';
  });

  it('refines the seed title with an OpenAI response and persists it', async () => {
    process.env.NODE_ENV = 'development';
    db._setSelectQueue([
      [{ id: 'conv_1', title: 'New AI Assist conversation' }]
    ]);
    db._setReturning([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'a',
      activeStudent: { id: 's1', displayName: 'Ada' },
      assistantMessage: { linkHints: {} }
    });
    openAIClient.responses.create.mockResolvedValue({
      output_text: 'Refined Ada title'
    });
    const refineDb = makeDb();
    refineDb._setReturning([{ id: 'conv_1' }]);
    // getPostgresDb is called again inside the timer for the refinement update
    getPostgresDb.mockReturnValueOnce(db).mockReturnValue(refineDb);

    const req = mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'summarize Ada' }
    });
    await controller.sendMessage(req, mockRes(), jest.fn());

    // flush the setTimeout(0) refinement task
    await jest.runOnlyPendingTimersAsync();

    expect(openAIClient.responses.create).toHaveBeenCalled();
    expect(refineDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Refined Ada title' })
    );
  });

  it('skips persistence when the refined title equals the seed title', async () => {
    process.env.NODE_ENV = 'development';
    db._setSelectQueue([
      [{ id: 'conv_1', title: 'New AI Assist conversation' }]
    ]);
    db._setReturning([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'a',
      activeStudent: { id: 's1', displayName: 'Ada' },
      assistantMessage: { linkHints: {} }
    });
    // refined title equals the rule-based seed ("Ada") -> no update
    openAIClient.responses.create.mockResolvedValue({ output_text: 'Ada' });
    const refineDb = makeDb();
    getPostgresDb.mockReturnValueOnce(db).mockReturnValue(refineDb);

    await controller.sendMessage(
      mockReq({
        user: USER,
        params: { conversationId: 'conv_1' },
        body: { message: 'summarize Ada' }
      }),
      mockRes(),
      jest.fn()
    );
    await jest.runOnlyPendingTimersAsync();

    expect(refineDb.set).not.toHaveBeenCalled();
  });

  it('logs a warning and skips persistence when refinement throws', async () => {
    process.env.NODE_ENV = 'development';
    db._setSelectQueue([
      [{ id: 'conv_1', title: 'New AI Assist conversation' }]
    ]);
    db._setReturning([{ id: 'conv_1' }]);
    orchestrator.runAiAssist.mockResolvedValue({
      answer: 'a',
      activeStudent: { id: 's1', displayName: 'Ada' },
      assistantMessage: { linkHints: {} }
    });
    openAIClient.responses.create.mockRejectedValue(new Error('llm down'));

    const req = mockReq({
      user: USER,
      params: { conversationId: 'conv_1' },
      body: { message: 'summarize Ada' }
    });
    await controller.sendMessage(req, mockRes(), jest.fn());
    await jest.runOnlyPendingTimersAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('title refinement skipped')
    );
  });
});

// ---------------------------------------------------------------------------
// listRecentStudents pagination
// ---------------------------------------------------------------------------
describe('listRecentStudents pagination', () => {
  it('advances the offset across a full batch, then stops on a short batch', async () => {
    // First batch is full (50 rows) but mostly duplicate studentIds so only a
    // handful of unique students are collected -> loop must page again. The
    // second batch is short (< 50) so the loop then breaks.
    const firstBatch = Array.from({ length: 50 }, (_, i) => ({
      id: `conv_${i}`,
      studentId: `s_${i % 10}` // 10 unique ids
    }));
    const secondBatch = [{ id: 'conv_x', studentId: 's_extra' }];
    db._setSelectQueue([firstBatch, secondBatch]);
    getAccessibleStudentFilter.mockResolvedValue({});
    StudentService.findStudentsSelect.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) =>
        i < 10
          ? { _id: { toString: () => `s_${i}` } }
          : { _id: { toString: () => 's_extra' } }
      )
    );
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listRecentStudents(req, res, jest.fn());

    // 10 unique from first batch + 1 from second = 11 collected
    expect(
      StudentService.findStudentsSelect.mock.calls[0][0]._id.$in
    ).toHaveLength(11);
    // the offset advanced after the full first batch
    expect(db.offset).toHaveBeenCalledWith(50);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('stops collecting once the unique-student cap is hit within a batch', async () => {
    // 50 distinct students in one batch -> the inner loop breaks at 25.
    const batch = Array.from({ length: 50 }, (_, i) => ({
      id: `conv_${i}`,
      studentId: `s_${i}`
    }));
    db._setSelectQueue([batch]);
    getAccessibleStudentFilter.mockResolvedValue({});
    StudentService.findStudentsSelect.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        _id: { toString: () => `s_${i}` }
      }))
    );
    const req = mockReq({ user: USER });
    const res = mockRes();

    await controller.listRecentStudents(req, res, jest.fn());

    expect(
      StudentService.findStudentsSelect.mock.calls[0][0]._id.$in
    ).toHaveLength(25);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// generateReplyDraft
// ---------------------------------------------------------------------------
const streamRes = () => {
  const res = mockRes();
  res.setHeader = jest.fn(() => res);
  res.flushHeaders = jest.fn(() => res);
  res.write = jest.fn(() => true);
  return res;
};

describe('generateReplyDraft', () => {
  it('streams the model tokens and charges the AI quota on success', async () => {
    requireAccessibleStudent.mockResolvedValue(undefined);
    orchestrator.runAiAssist.mockImplementation(async (_pg, opts) => {
      await opts.onToken('Hello ');
      await opts.onToken('world');
      return { answer: 'Hello world' };
    });
    const req = mockReq({ user: USER, params: { studentId: 's1' } });
    const res = streamRes();

    await controller.generateReplyDraft(req, res, jest.fn());

    // Reply mode is requested, scoped to the student.
    const opts = orchestrator.runAiAssist.mock.calls[0][1];
    expect(opts.replyMode).toBe(true);
    expect(opts.assistContext.mentionedStudent.id).toBe('s1');
    expect(res.write).toHaveBeenCalledWith('Hello ');
    expect(res.write).toHaveBeenCalledWith('world');
    expect(res.end).toHaveBeenCalled();
    expect(PermissionService.decrementTaigerAiQuota).toHaveBeenCalledTimes(1);
    // No sensitive content by default.
    expect(res.setHeader).toHaveBeenCalledWith('X-Reply-Sensitive', '0');
  });

  it('flags X-Reply-Sensitive when the latest student message reads as distressed', async () => {
    requireAccessibleStudent.mockResolvedValue(undefined);
    CommunicationService.getRecentByStudentId.mockResolvedValue([
      {
        user_id: { role: 'Student' },
        message: JSON.stringify({
          blocks: [{ type: 'paragraph', data: { text: 'I am so angry, I want a refund' } }]
        })
      }
    ]);
    orchestrator.runAiAssist.mockResolvedValue({ answer: 'Reply.' });
    const req = mockReq({ user: USER, params: { studentId: 's1' } });
    const res = streamRes();

    await controller.generateReplyDraft(req, res, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith('X-Reply-Sensitive', '1');
  });

  it('writes the full answer as a fallback when no tokens stream', async () => {
    requireAccessibleStudent.mockResolvedValue(undefined);
    orchestrator.runAiAssist.mockResolvedValue({ answer: 'Full reply.' });
    const req = mockReq({ user: USER, params: { studentId: 's1' } });
    const res = streamRes();

    await controller.generateReplyDraft(req, res, jest.fn());

    expect(res.write).toHaveBeenCalledWith('Full reply.');
    expect(res.end).toHaveBeenCalled();
  });

  it('does not generate or charge quota when the student is not accessible', async () => {
    requireAccessibleStudent.mockRejectedValue(new Error('forbidden'));
    const req = mockReq({ user: USER, params: { studentId: 's_forbidden' } });
    const res = streamRes();
    const next = jest.fn();

    await controller.generateReplyDraft(req, res, next);

    expect(orchestrator.runAiAssist).not.toHaveBeenCalled();
    expect(PermissionService.decrementTaigerAiQuota).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('emits an inline notice and never throws when generation fails mid-stream', async () => {
    requireAccessibleStudent.mockResolvedValue(undefined);
    orchestrator.runAiAssist.mockRejectedValue(new Error('provider down'));
    const req = mockReq({ user: USER, params: { studentId: 's1' } });
    const res = streamRes();

    await controller.generateReplyDraft(req, res, jest.fn());

    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('temporarily unavailable')
    );
    expect(res.end).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('never persists to the conversation store or sends a message (draft only)', async () => {
    requireAccessibleStudent.mockResolvedValue(undefined);
    orchestrator.runAiAssist.mockResolvedValue({ answer: 'Draft.' });
    const req = mockReq({ user: USER, params: { studentId: 's1' } });
    const res = streamRes();

    await controller.generateReplyDraft(req, res, jest.fn());

    // Reply-draft must not touch the shared conversation DB at all...
    expect(getPostgresDb).not.toHaveBeenCalled();
    // ...the handle handed to the orchestrator is the ephemeral, read-disabled
    // stub (no `.select`), so no conversation/message/trace rows are written...
    const pgHandle = orchestrator.runAiAssist.mock.calls[0][0];
    expect(pgHandle.select).toBeUndefined();
    // ...and it never returns a sent-message payload. The send pipeline replies
    // via res.send; reply-draft only streams text and ends. This is the
    // human-in-the-loop guarantee: generating a draft can never send it.
    expect(res.send).not.toHaveBeenCalled();
  });
});
