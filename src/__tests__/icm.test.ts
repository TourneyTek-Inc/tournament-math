import { describe, expect, it } from 'vitest';
import {
  buildIcmSplitTable,
  calculateIcmEquity,
  computeIcmSplit,
  IcmFieldTooLargeError,
  MAX_PLAYERS,
} from '../icm.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('calculateIcmEquity', () => {
  it('splits a heads-up pot by the hand-computable expectation', () => {
    // A holds 75% of chips, so P(A wins) = 0.75.
    //   A = 0.75*70 + 0.25*30 = 60
    //   B = 0.25*70 + 0.75*30 = 40
    const equity = calculateIcmEquity({ stacks: [75, 25], prizes: [70, 30] });
    expect(equity[0]).toBeCloseTo(60, 10);
    expect(equity[1]).toBeCloseTo(40, 10);
  });

  it('matches the hand-computed Malmuth-Harville result for three players', () => {
    // Worked by hand from the recursion, stacks 50/30/20, prizes 50/30/20:
    //   A = 25 + 0.3*(50/70)*30 + 0.2*(50/80)*30 + P(A 3rd)*20 = 38.392857…
    //   B = 15 + 0.5*(30/50)*30 + 0.2*(30/80)*30 + P(B 3rd)*20 = 32.75
    //   C = 10 + 0.5*(20/50)*30 + 0.3*(20/70)*30 + P(C 3rd)*20 = 28.857142…
    const equity = calculateIcmEquity({ stacks: [50, 30, 20], prizes: [50, 30, 20] });
    expect(equity[0]).toBeCloseTo(38.392857, 5);
    expect(equity[1]).toBeCloseTo(32.75, 5);
    expect(equity[2]).toBeCloseTo(28.857142, 5);
  });

  it('conserves the prize pool', () => {
    const equity = calculateIcmEquity({
      stacks: [12000, 8400, 5100, 3000, 1500],
      prizes: [500, 300, 150, 50],
    });
    expect(sum(equity)).toBeCloseTo(1000, 8);
  });

  it('gives equal stacks equal equity', () => {
    const equity = calculateIcmEquity({ stacks: [1000, 1000, 1000], prizes: [50, 30, 20] });
    for (const e of equity) expect(e).toBeCloseTo(100 / 3, 10);
  });

  it('orders equity by stack size', () => {
    const equity = calculateIcmEquity({ stacks: [9000, 4000, 2000, 1000], prizes: [60, 30, 10] });
    expect(equity[0]).toBeGreaterThan(equity[1]);
    expect(equity[1]).toBeGreaterThan(equity[2]);
    expect(equity[2]).toBeGreaterThan(equity[3]);
  });

  it('never awards a player more than the top prize', () => {
    // A 99.9% stack still cannot beat first place money.
    const equity = calculateIcmEquity({ stacks: [999_000, 1000], prizes: [100, 60] });
    expect(equity[0]).toBeLessThanOrEqual(100);
    expect(equity[0]).toBeGreaterThan(99);
  });

  it('pays zero to stackless players and still conserves the pool', () => {
    const equity = calculateIcmEquity({ stacks: [500, 0, 500], prizes: [80, 20] });
    expect(equity[1]).toBe(0);
    expect(sum(equity)).toBeCloseTo(100, 10);
  });

  it('treats negative and non-numeric stacks as zero', () => {
    const equity = calculateIcmEquity({
      stacks: [100, -50, Number.NaN as number],
      prizes: [10],
    });
    expect(equity[1]).toBe(0);
    expect(equity[2]).toBe(0);
    expect(equity[0]).toBeCloseTo(10, 10);
  });

  it('pays nothing beyond the prize list when players outnumber prizes', () => {
    const equity = calculateIcmEquity({ stacks: [100, 100, 100], prizes: [100] });
    expect(sum(equity)).toBeCloseTo(100, 10);
  });

  it('returns zeros when there are no prizes or no chips', () => {
    expect(calculateIcmEquity({ stacks: [10, 20], prizes: [] })).toEqual([0, 0]);
    expect(calculateIcmEquity({ stacks: [0, 0], prizes: [100] })).toEqual([0, 0]);
  });

  it('returns an empty array for an empty field', () => {
    expect(calculateIcmEquity({ stacks: [], prizes: [100] })).toEqual([]);
  });

  it('refuses a field too large to compute rather than hanging', () => {
    const stacks = new Array(MAX_PLAYERS + 1).fill(1000);
    expect(() => calculateIcmEquity({ stacks, prizes: [100] })).toThrow(IcmFieldTooLargeError);
  });

  it('computes the largest supported field in reasonable time', () => {
    const stacks = Array.from({ length: MAX_PLAYERS }, (_, i) => (i + 1) * 1000);
    const started = Date.now();
    const equity = calculateIcmEquity({ stacks, prizes: [500, 300, 200] });
    expect(sum(equity)).toBeCloseTo(1000, 6);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('buildIcmSplitTable', () => {
  it('attaches equity and sorts by stack descending, preserving extra fields', () => {
    const rows = buildIcmSplitTable(
      [
        { id: 'b', displayName: 'Bea', stack: 3000, seat: 4 },
        { id: 'a', displayName: 'Al', stack: 6000, seat: 1 },
        { id: 'c', displayName: 'Cy', stack: 1000, seat: 7 },
      ],
      [100, 60, 40],
    );

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0].seat).toBe(1);
    expect(rows[0].displayName).toBe('Al');
    expect(sum(rows.map((r) => r.equity))).toBeCloseTo(200, 8);
  });
});

describe('computeIcmSplit', () => {
  it('disables itself until two players have chips', () => {
    expect(computeIcmSplit([5000, 0, 0], [100, 50])).toEqual({
      enabled: false,
      values: [0, 0, 0],
    });
  });

  it('enables once a second stack appears', () => {
    const result = computeIcmSplit([5000, 5000], [100, 50]);
    expect(result.enabled).toBe(true);
    expect(sum(result.values)).toBeCloseTo(150, 8);
  });
});
