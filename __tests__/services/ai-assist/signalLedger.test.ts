// Unit tests for the pure signal-ledger helpers (no LLM, no DB).

import signalLedger from '../../../services/ai-assist/signalLedger';

const { mergeSignals, rollupRiskLevel, withSourceRefs } = signalLedger as any;

describe('signalLedger.withSourceRefs', () => {
  const messages = [
    { id: 'm1', at: '2026-05-01T00:00:00.000Z' },
    { id: 'm2', at: '2026-05-02T00:00:00.000Z' }
  ];

  it('maps a 1-based msgIndex to the source id + timestamp', () => {
    const [a, b] = withSourceRefs(
      [{ msgIndex: 1 }, { msgIndex: 2 }],
      messages
    );
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

  it('normalises model case + spaced types instead of dropping them', () => {
    const out = mergeSignals(
      [],
      [
        { type: 'Broken Promise', severity: 'High', evidence: 'x' },
        { type: 'FRUSTRATION', severity: ' low ', evidence: 'y' }
      ],
      now
    );
    expect(out.map((s) => s.type)).toEqual(['broken_promise', 'frustration']);
    expect(out.map((s) => s.severity)).toEqual(['high', 'low']);
  });

  it('stamps firstSeenAt = now for a brand new signal type', () => {
    const out = mergeSignals([], [{ type: 'frustration', severity: 'low', evidence: 'e' }], now);
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
      rollupRiskLevel([{ type: 'frustration', severity: 'high', resolved: true }])
    ).toBe('none');
  });
});
