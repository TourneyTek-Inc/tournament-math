/**
 * Stack pressure: big blinds and Harrington's M-ratio.
 *
 * M is the number of orbits a stack can survive paying blinds and antes
 * without playing a hand — the standard measure of how urgently a player
 * must act. BB count is the cruder but more universal sibling.
 */

export type PressureZone = 'Green' | 'Yellow' | 'Orange' | 'Red';

export interface StackPressureResult {
  /** Stack measured in big blinds. */
  bbCount: number;
  /** Harrington M: orbits survivable while folding every hand. */
  mRatio: number;
  /** Bucketed pressure. Worst of the two measures wins. */
  zone: PressureZone;
}

export interface StackPressureInput {
  chips: number;
  sb: number;
  bb: number;
  ante: number;
  /** Players dealt in — antes scale with the field, so M does too. */
  playersInHand: number;
}

/**
 * Harrington's zones, applied to whichever measure is more pessimistic:
 * Green ≥ 20M, Yellow 10-20M, Orange 6-10M, Red < 6M — with BB-count
 * thresholds alongside, since a big ante can flatter M relative to how
 * the stack actually plays.
 */
export function computeStackPressure(input: StackPressureInput): StackPressureResult {
  const bb = Math.max(1, input.bb);
  const sb = Math.max(0, input.sb);
  const ante = Math.max(0, input.ante);
  const players = Math.max(2, input.playersInHand);
  const chips = Math.max(0, Number(input.chips) || 0);

  const orbitCost = sb + bb + ante * players;
  const mRatio = orbitCost > 0 ? chips / orbitCost : 0;
  const bbCount = chips / bb;

  let zone: PressureZone = 'Green';
  if (mRatio < 6 || bbCount < 10) zone = 'Red';
  else if (mRatio < 10 || bbCount < 15) zone = 'Orange';
  else if (mRatio < 20 || bbCount < 25) zone = 'Yellow';

  return { bbCount, mRatio, zone };
}
