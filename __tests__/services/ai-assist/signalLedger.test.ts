// Unit tests for the signal-ledger: pure helpers + the per-student scan path
// (DB / LLM / services mocked).

jest.mock('../../../database', () => ({ getPostgresDb: jest.fn() }));
jest.mock('../../../services/communications', () => ({
  findPopulatedSorted: jest.fn(),
  getLatestMessageAtForStudents: jest.fn()
}));
jest.mock('../../../services/openai', () => ({
  openAIClient: { responses: { create: jest.fn() } },
  OpenAiModel: { GPT_5_4_mini: 'gpt-5.4-mini' }
}));
jest.mock('../../../services/ai-assist/tools', () => ({
  requireAccessibleStudent: jest.fn()
}));
jest.mock('../../../services/students', () => ({
  findStudentsSelect: jest.fn()
}));

import signalLedger from '../../../services/ai-assist/signalLedger';
import * as databaseModule from '../../../database';
import CommunicationService from '../../../services/communications';
import { openAIClient } from '../../../services/openai';
import toolsModule from '../../../services/ai-assist/tools';

const getPostgresDb = (databaseModule as any).getPostgresDb as jest.Mock;
const findPopulatedSorted = (CommunicationService as any)
  .findPopulatedSorted as jest.Mock;
const openAiCreate = (openAIClient as any).responses.create as jest.Mock;
const requireAccessibleStudent = (toolsModule as any)
  .requireAccessibleStudent as jest.Mock;

const {
  mergeSignals,
  rollupRiskLevel,
  withSourceRefs,
  buildScanMessages,
  safeParseJson,
  extractOutputText
} = signalLedger as any;

describe('signalLedger.safeParseJson', () => {
  it('parses clean JSON', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('extracts the JSON object embedded in surrounding text', () => {
    expect(safeParseJson('noise {"a":1} tail')).toEqual({ a: 1 });
  });
  it('returns null for non-string and for unparseable text', () => {
    expect(safeParseJson(null)).toBeNull();
    expect(safeParseJson('no json here')).toBeNull();
  });
});

describe('signalLedger.extractOutputText', () => {
  it('prefers output_text', () => {
    expect(extractOutputText({ output_text: 'hi' })).toBe('hi');
  });
  it('falls back to output[].content[].text', () => {
    expect(
      extractOutputText({
        output: [{ content: [{ text: 'a' }, { text: 'b' }] }]
      })
    ).toBe('a\nb');
  });
});

describe('signalLedger.buildScanMessages', () => {
  it('keeps only text-bearing messages and tags student vs team', () => {
    const out = buildScanMessages([
      {
        _id: 'm1',
        message: 'hi',
        user_id: { role: 'Student' },
        createdAt: '2026-05-01'
      },
      { _id: 'm2', message: '', user_id: { role: 'Agent' } }, // dropped: no text
      {
        _id: 'm3',
        message: 'reply',
        user_id: { role: 'Agent' },
        createdAt: '2026-05-02'
      }
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'm1', from: 'student' });
    expect(out[1]).toMatchObject({ id: 'm3', from: 'team' });
    expect(out[0].at).toContain('2026-05-01');
  });
});

describe('signalLedger.withSourceRefs', () => {
  const messages = [
    { id: 'm1', at: '2026-05-01T00:00:00.000Z' },
    { id: 'm2', at: '2026-05-02T00:00:00.000Z' }
  ];

  it('maps a 1-based msgIndex to the source id + timestamp', () => {
    const [a, b] = withSourceRefs([{ msgIndex: 1 }, { msgIndex: 2 }], messages);
    expect(a.sourceMessageId).toBe('m1');
    expect(a.occurredAt).toBe('2026-05-01T00:00:00.000Z');
    expect(b.sourceMessageId).toBe('m2');
  });

  it('nulls out-of-range / missing indices', () => {
    const [a, b, c] = withSourceRefs(
      [{ msgIndex: 0 }, { msgIndex: 9 }, {}],
      messages
    );
    [a, b, c].forEach((s) => {
      expect(s.sourceMessageId).toBeNull();
      expect(s.occurredAt).toBeNull();
    });
  });
});

describe('signalLedger.mergeSignals', () => {
  const now = new Date('2026-06-19T00:00:00.000Z');

  it('drops signals with an unknown type or severity', () => {
    const out = mergeSignals(
      [],
      [
        { type: 'frustration', severity: 'high', evidence: 'x' },
        { type: 'not_a_real_type', severity: 'high', evidence: 'y' },
        { type: 'confusion', severity: 'critical', evidence: 'z' }
      ],
      now
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('frustration');
  });

  it('carries forward firstSeenAt from a prior signal of the same type', () => {
    const prior = [
      {
        type: 'broken_promise',
        severity: 'medium',
        evidence: 'old',
        firstSeenAt: '2026-04-01T00:00:00.000Z'
      }
    ];
    const out = mergeSignals(
      prior,
      [{ type: 'broken_promise', severity: 'high', evidence: 'new' }],
      now
    );
    expect(out[0].firstSeenAt).toBe('2026-04-01T00:00:00.000Z');
    expect(out[0].lastSeenAt).toBe(now.toISOString());
    expect(out[0].severity).toBe('high');
  });

  it('passes through sourceMessageId + occurredAt from the new signal', () => {
    const out = mergeSignals(
      [],
      [
        {
          type: 'frustration',
          severity: 'high',
          sourceMessageId: 'm7',
          occurredAt: '2026-05-10T00:00:00.000Z'
        }
      ],
      now
    );
    expect(out[0].sourceMessageId).toBe('m7');
    expect(out[0].occurredAt).toBe('2026-05-10T00:00:00.000Z');
  });

  it('carries forward prior source ref when the new scan no longer references it', () => {
    const prior = [
      {
        type: 'broken_promise',
        severity: 'medium',
        sourceMessageId: 'old-msg',
        occurredAt: '2026-03-01T00:00:00.000Z',
        firstSeenAt: '2026-03-01T00:00:00.000Z'
      }
    ];
    const out = mergeSignals(
      prior,
      // re-detected from prior context only — no source message this scan
      [{ type: 'broken_promise', severity: 'high' }],
      now
    );
    expect(out[0].sourceMessageId).toBe('old-msg');
    expect(out[0].occurredAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('normalises model case + spaced types instead of dropping them', () => {
    const out = mergeSignals(
      [],
      [
        { type: 'Broken Promise', severity: 'High', evidence: 'x' },
        { type: 'FRUSTRATION', severity: ' low ', evidence: 'y' }
      ],
      now
    );
    expect(out.map((s: any) => s.type)).toEqual([
      'broken_promise',
      'frustration'
    ]);
    expect(out.map((s: any) => s.severity)).toEqual(['high', 'low']);
  });

  it('stamps firstSeenAt = now for a brand new signal type', () => {
    const out = mergeSignals(
      [],
      [{ type: 'frustration', severity: 'low', evidence: 'e' }],
      now
    );
    expect(out[0].firstSeenAt).toBe(now.toISOString());
  });
});

describe('signalLedger.rollupRiskLevel', () => {
  it('returns the highest unresolved severity', () => {
    expect(
      rollupRiskLevel([
        { type: 'frustration', severity: 'low', resolved: false },
        { type: 'broken_promise', severity: 'high', resolved: false }
      ])
    ).toBe('high');
  });

  it('ignores resolved signals', () => {
    expect(
      rollupRiskLevel([
        { type: 'broken_promise', severity: 'high', resolved: true },
        { type: 'frustration', severity: 'low', resolved: false }
      ])
    ).toBe('low');
  });

  it('returns none for an empty / all-resolved set', () => {
    expect(rollupRiskLevel([])).toBe('none');
    expect(
      rollupRiskLevel([
        { type: 'frustration', severity: 'high', resolved: true }
      ])
    ).toBe('none');
  });
});

// ---- Per-student scan path (mocked DB / LLM / services) --------------------

const { scanStudentSignals, getSignalsForStudents, getStudentSignalRow } =
  signalLedger as any;

// Chainable postgres stub: select().from().where()(.limit()) resolves to `rows`.
const buildPg = (rows: any[], insertMock: jest.Mock) => ({
  select: () => ({
    from: () => ({
      where: () => {
        const p: any = Promise.resolve(rows);
        p.limit = () => Promise.resolve(rows);
        return p;
      }
    })
  }),
  insert: insertMock
});

const okInsert = () =>
  jest.fn(() => ({
    values: () => ({ onConflictDoUpdate: () => Promise.resolve() })
  }));

const studentMsg = (id: string, text: string, at: string) => ({
  _id: id,
  message: text,
  user_id: { role: 'Student' },
  createdAt: at
});

describe('signalLedger.scanStudentSignals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAccessibleStudent.mockResolvedValue({
      _id: 's1',
      firstname: 'A',
      lastname: 'B',
      role: 'Student'
    });
  });

  it('cold start: no date filter, classifies, upserts, attaches source ref', async () => {
    const insertMock = okInsert();
    getPostgresDb.mockReturnValue(buildPg([], insertMock)); // no prior row
    findPopulatedSorted.mockResolvedValue([
      studentMsg('m1', 'I am very frustrated', '2026-05-01T00:00:00.000Z')
    ]);
    openAiCreate.mockResolvedValue({
      output_text: JSON.stringify({
        signals: [
          {
            type: 'frustration',
            severity: 'high',
            summaryEn: 'Frustrated',
            summaryZh: '不滿',
            evidence: 'frustrated',
            msgIndex: 1
          }
        ]
      })
    });

    const row = await scanStudentSignals({}, 's1');

    const filterArg = findPopulatedSorted.mock.calls[0][0];
    expect(filterArg.createdAt).toBeUndefined(); // cold start: no date floor
    expect(insertMock).toHaveBeenCalled();
    expect(row.riskLevel).toBe('high');
    expect(row.signals[0].sourceMessageId).toBe('m1');
    expect(row.signals[0].occurredAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('incremental: filters messages since lastScannedAt', async () => {
    getPostgresDb.mockReturnValue(
      buildPg(
        [
          {
            studentId: 's1',
            lastScannedAt: '2026-04-01T00:00:00.000Z',
            signals: []
          }
        ],
        okInsert()
      )
    );
    findPopulatedSorted.mockResolvedValue([]);

    await scanStudentSignals({}, 's1');

    const filterArg = findPopulatedSorted.mock.calls[0][0];
    expect(filterArg.createdAt).toHaveProperty('$gt');
  });

  it('no new messages: returns prior row, no upsert', async () => {
    const insertMock = okInsert();
    const prior = {
      studentId: 's1',
      lastScannedAt: '2026-04-01T00:00:00.000Z',
      signals: []
    };
    getPostgresDb.mockReturnValue(buildPg([prior], insertMock));
    findPopulatedSorted.mockResolvedValue([]);

    const row = await scanStudentSignals({}, 's1');

    expect(insertMock).not.toHaveBeenCalled();
    expect(row).toEqual(prior);
  });

  it('LLM unparseable: returns prior, no upsert', async () => {
    const insertMock = okInsert();
    getPostgresDb.mockReturnValue(buildPg([], insertMock));
    findPopulatedSorted.mockResolvedValue([
      studentMsg('m1', 'hi', '2026-05-01T00:00:00.000Z')
    ]);
    openAiCreate.mockResolvedValue({ output_text: 'not json' });

    const row = await scanStudentSignals({}, 's1');
    expect(insertMock).not.toHaveBeenCalled();
    expect(row).toBeNull();
  });
});

describe('signalLedger read gating', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getSignalsForStudents keeps only rows with unresolved signals', async () => {
    getPostgresDb.mockReturnValue(
      buildPg(
        [
          {
            studentId: 's1',
            riskLevel: 'high',
            signals: [{ resolved: false }]
          },
          { studentId: 's2', riskLevel: 'none', signals: [{ resolved: true }] }
        ],
        okInsert()
      )
    );
    const map = await getSignalsForStudents(['s1', 's2']);
    expect(map.has('s1')).toBe(true);
    expect(map.has('s2')).toBe(false);
  });

  it('getStudentSignalRow returns null when all signals resolved', async () => {
    getPostgresDb.mockReturnValue(
      buildPg([{ studentId: 's1', signals: [{ resolved: true }] }], okInsert())
    );
    expect(await getStudentSignalRow('s1')).toBeNull();
  });
});

describe('signalLedger edge branches', () => {
  it('safeParseJson returns null when braces wrap invalid JSON', () => {
    expect(safeParseJson('x {not valid} y')).toBeNull();
  });
  it('withSourceRefs tolerates a non-array input', () => {
    expect(withSourceRefs(null, [])).toEqual([]);
  });
  it('buildScanMessages yields at=null when message has no timestamp', () => {
    const out = buildScanMessages([
      { _id: 'm1', message: 'hi', user_id: { role: 'Student' } }
    ]);
    expect(out[0].at).toBeNull();
  });
  it('mergeSignals on non-array llmSignals returns []', () => {
    expect(mergeSignals([], null, new Date())).toEqual([]);
  });
});
