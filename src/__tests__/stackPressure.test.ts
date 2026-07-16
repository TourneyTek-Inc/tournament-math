import { describe, expect, it } from 'vitest';
import { computeStackPressure } from '../stackPressure.js';

describe('computeStackPressure', () => {
  it('computes M as orbits survivable while folding', () => {
    // Orbit cost = 100 + 200 + 25*9 = 525. 10500 / 525 = 20 orbits.
    const result = computeStackPressure({
      chips: 10_500,
      sb: 100,
      bb: 200,
      ante: 25,
      playersInHand: 9,
    });
    expect(result.mRatio).toBeCloseTo(20, 10);
    expect(result.bbCount).toBeCloseTo(52.5, 10);
  });

  it('counts big blinds independently of antes', () => {
    const result = computeStackPressure({
      chips: 5000,
      sb: 100,
      bb: 200,
      ante: 0,
      playersInHand: 9,
    });
    expect(result.bbCount).toBeCloseTo(25, 10);
  });

  it('shrinks M as the table fills, since antes scale with the field', () => {
    const base = { chips: 10_000, sb: 100, bb: 200, ante: 50 };
    const shortHanded = computeStackPressure({ ...base, playersInHand: 3 });
    const fullRing = computeStackPressure({ ...base, playersInHand: 9 });
    expect(fullRing.mRatio).toBeLessThan(shortHanded.mRatio);
    expect(fullRing.bbCount).toBeCloseTo(shortHanded.bbCount, 10);
  });

  // Orbit cost is 150 (sb 50 + bb 100, no ante), so M = chips / 150.
  it.each([
    { chips: 100_000, m: 666.7, expected: 'Green' },
    { chips: 2900, m: 19.3, expected: 'Yellow' },
    { chips: 1400, m: 9.3, expected: 'Orange' },
    { chips: 800, m: 5.3, expected: 'Red' },
  ])('buckets $chips chips (M≈$m) into the $expected zone', ({ chips, expected }) => {
    const result = computeStackPressure({ chips, sb: 50, bb: 100, ante: 0, playersInHand: 9 });
    expect(result.zone).toBe(expected);
  });

  it('takes the more pessimistic of M and BB count', () => {
    // A huge ante flatters BB count while M collapses.
    const result = computeStackPressure({
      chips: 3000,
      sb: 50,
      bb: 100,
      ante: 100,
      playersInHand: 9,
    });
    expect(result.bbCount).toBe(30); // would be Green on BBs alone
    expect(result.mRatio).toBeCloseTo(2.857, 3);
    expect(result.zone).toBe('Red');
  });

  it('never divides by zero on a blindless or empty input', () => {
    const result = computeStackPressure({ chips: 0, sb: 0, bb: 0, ante: 0, playersInHand: 0 });
    expect(Number.isFinite(result.mRatio)).toBe(true);
    expect(Number.isFinite(result.bbCount)).toBe(true);
    expect(result.zone).toBe('Red');
  });

  it('clamps negative inputs rather than emitting negative pressure', () => {
    const result = computeStackPressure({
      chips: -500,
      sb: -10,
      bb: -10,
      ante: -10,
      playersInHand: -5,
    });
    expect(result.mRatio).toBeGreaterThanOrEqual(0);
    expect(result.bbCount).toBeGreaterThanOrEqual(0);
  });
});
