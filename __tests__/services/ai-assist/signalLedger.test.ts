// Unit tests for the pure signal-ledger helpers (no LLM, no DB).

import signalLedger from '../../../services/ai-assist/signalLedger';

const { mergeSignals, rollupRiskLevel } = signalLedger as any;

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
