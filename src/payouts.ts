/**
 * Prize-pool payout curves.
 *
 * Splits a pot across N paid places using one of three shapes. All three
 * are integer-safe: the returned amounts always sum to exactly
 * `totalPot`, with rounding remainder handled explicitly rather than left
 * to float drift. Money that silently evaporates in a payout table is the
 * kind of bug players notice at the cage.
 */

export interface Payout {
  /** 1-indexed finishing position. */
  place: number;
  /** Amount awarded, in the same (minor or major) unit as `totalPot`. */
  amount: number;
}

/**
 * - `standard`  — geometric decay, factor 0.65. A conventional curve.
 * - `topHeavy`  — geometric decay, factor 0.45. Rewards the win harder.
 * - `flat`      — every place paid equally (remainder to the earliest places).
 */
export type PayoutFormula = 'standard' | 'topHeavy' | 'flat';

const DECAY_FACTOR: Record<Exclude<PayoutFormula, 'flat'>, number> = {
  topHeavy: 0.45,
  standard: 0.65,
};

export interface CalculatePayoutsInput {
  /** Total prize pool to distribute. Non-finite or negative values yield []. */
  totalPot: number;
  /** How many places get paid. Zero or negative yields []. */
  payoutCount: number;
  /** Curve shape. @default 'standard' */
  formula?: PayoutFormula;
}

/**
 * Split `totalPot` across `payoutCount` places.
 *
 * Guarantees `payouts.reduce((s, p) => s + p.amount, 0) === totalPot`
 * exactly, for every formula, whenever `totalPot` is a non-negative
 * integer.
 */
export function calculatePayouts({
  totalPot,
  payoutCount,
  formula = 'standard',
}: CalculatePayoutsInput): Payout[] {
  const places = Math.floor(Number(payoutCount) || 0);
  const pot = Number(totalPot);

  // Reject the degenerate inputs up front rather than dividing by zero
  // and returning a table full of Infinity.
  if (places <= 0) return [];
  if (!Number.isFinite(pot) || pot <= 0) {
    return Array.from({ length: places }, (_, i) => ({ place: i + 1, amount: 0 }));
  }

  if (formula === 'flat') {
    const baseShare = Math.floor(pot / places);
    const remainder = pot - baseShare * places;
    // Spread the indivisible remainder one unit at a time across the
    // earliest places, rather than dumping it all on first.
    return Array.from({ length: places }, (_, i) => ({
      place: i + 1,
      amount: baseShare + (i < remainder ? 1 : 0),
    }));
  }

  const decay = DECAY_FACTOR[formula] ?? DECAY_FACTOR.standard;
  const raw = Array.from({ length: places }, (_, i) => Math.pow(decay, i));
  const rawTotal = raw.reduce((sum, val) => sum + val, 0);
  const weights = raw.map((val) => val / rawTotal);

  const payouts: Payout[] = weights.map((weight, i) => ({
    place: i + 1,
    amount: Math.round(pot * weight),
  }));

  // Rounding each place independently can drift a unit or two either
  // way. Reconcile against the pot and give the difference to first —
  // it's the largest prize, so the relative distortion is smallest.
  const distributed = payouts.reduce((sum, p) => sum + p.amount, 0);
  const drift = pot - distributed;
  if (drift !== 0 && payouts.length > 0) {
    payouts[0].amount += drift;
  }

  return payouts;
}
