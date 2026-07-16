import { describe, expect, it } from 'vitest';
import { calculatePayouts, type PayoutFormula } from '../payouts.js';

const total = (xs: { amount: number }[]) => xs.reduce((a, b) => a + b.amount, 0);
const FORMULAS: PayoutFormula[] = ['standard', 'topHeavy', 'flat'];

describe('calculatePayouts', () => {
  it.each(FORMULAS)('conserves the pot exactly (%s)', (formula) => {
    // Pots chosen to be awkward: primes and values that don't divide evenly.
    for (const pot of [100, 997, 1000, 12345, 7]) {
      for (const places of [1, 2, 3, 5, 9]) {
        const payouts = calculatePayouts({ totalPot: pot, payoutCount: places, formula });
        expect(total(payouts), `${formula} pot=${pot} places=${places}`).toBe(pot);
      }
    }
  });

  it.each(FORMULAS)('returns one row per paid place, numbered from 1 (%s)', (formula) => {
    const payouts = calculatePayouts({ totalPot: 1000, payoutCount: 4, formula });
    expect(payouts.map((p) => p.place)).toEqual([1, 2, 3, 4]);
  });

  it('pays every place equally when flat, spreading the remainder forward', () => {
    // 100 across 3 ways = 33.33; the 1 left over goes to first.
    const payouts = calculatePayouts({ totalPot: 100, payoutCount: 3, formula: 'flat' });
    expect(payouts.map((p) => p.amount)).toEqual([34, 33, 33]);
  });

  it('pays exactly the pot to a single winner', () => {
    for (const formula of FORMULAS) {
      expect(calculatePayouts({ totalPot: 500, payoutCount: 1, formula })).toEqual([
        { place: 1, amount: 500 },
      ]);
    }
  });

  it('decays monotonically for the curved formulas', () => {
    for (const formula of ['standard', 'topHeavy'] as const) {
      const payouts = calculatePayouts({ totalPot: 10_000, payoutCount: 6, formula });
      for (let i = 1; i < payouts.length; i++) {
        expect(payouts[i].amount, formula).toBeLessThanOrEqual(payouts[i - 1].amount);
      }
    }
  });

  it('weights first place harder when topHeavy', () => {
    const standard = calculatePayouts({ totalPot: 10_000, payoutCount: 5, formula: 'standard' });
    const topHeavy = calculatePayouts({ totalPot: 10_000, payoutCount: 5, formula: 'topHeavy' });
    expect(topHeavy[0].amount).toBeGreaterThan(standard[0].amount);
    expect(topHeavy[4].amount).toBeLessThan(standard[4].amount);
  });

  it('defaults to the standard curve', () => {
    expect(calculatePayouts({ totalPot: 1000, payoutCount: 3 })).toEqual(
      calculatePayouts({ totalPot: 1000, payoutCount: 3, formula: 'standard' }),
    );
  });

  it('returns no rows when nobody is paid', () => {
    for (const formula of FORMULAS) {
      expect(calculatePayouts({ totalPot: 1000, payoutCount: 0, formula })).toEqual([]);
      expect(calculatePayouts({ totalPot: 1000, payoutCount: -3, formula })).toEqual([]);
    }
  });

  it('zeroes every place for an empty or invalid pot rather than emitting Infinity', () => {
    for (const formula of FORMULAS) {
      for (const pot of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
        const payouts = calculatePayouts({ totalPot: pot, payoutCount: 3, formula });
        expect(payouts.map((p) => p.amount), `${formula} pot=${pot}`).toEqual([0, 0, 0]);
      }
    }
  });

  it('never emits a negative prize', () => {
    for (const formula of FORMULAS) {
      for (const places of [1, 2, 3, 4, 8, 12]) {
        const payouts = calculatePayouts({ totalPot: 13, payoutCount: places, formula });
        for (const p of payouts) {
          expect(p.amount, `${formula} places=${places} place=${p.place}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
