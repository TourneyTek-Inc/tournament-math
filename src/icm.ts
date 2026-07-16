/**
 * Independent Chip Model (ICM) equity calculation.
 *
 * Given the remaining players' chip stacks and the remaining prize
 * payouts, returns each player's expected payout if the tournament were
 * settled by ICM equity — the standard basis for a chip-weighted deal at
 * a final table.
 *
 * Algorithm: Malmuth-Harville recursion. For each remaining prize place
 * (1st, 2nd, …), the probability that a given player finishes in that
 * place equals their stack share of the chips still in play (for 1st), or
 * the recursive expectation across the sub-pools formed by removing each
 * candidate from the remaining field (for lower places).
 *
 * Complexity is O(n!) in the number of players × prizes, which is fine at
 * typical final-table sizes (3-9 players, 3-9 prizes) and is why
 * `MAX_PLAYERS` exists. The implementation guards the obvious early-exit
 * cases — single player remaining, zero chips in play, fewer prizes than
 * players — so callers don't have to.
 */

/**
 * Refuse to start a recursion that would not finish in human time.
 *
 * Malmuth-Harville is factorial, so the wall-clock cost between "fine"
 * and "hangs the tab" is a couple of players wide: 10 players is
 * milliseconds, 15 is minutes, 20 outlives the tournament. Throwing at a
 * documented limit beats appearing to hang.
 */
export const MAX_PLAYERS = 12;

export class IcmFieldTooLargeError extends Error {
  readonly playerCount: number;
  readonly maxPlayers: number;

  constructor(playerCount: number) {
    super(
      `ICM is factorial in the field size; refusing to compute for ${playerCount} players ` +
        `(max ${MAX_PLAYERS}). ICM is a final-table tool — filter to the players still in ` +
        `contention for a prize before calling.`,
    );
    this.name = 'IcmFieldTooLargeError';
    this.playerCount = playerCount;
    this.maxPlayers = MAX_PLAYERS;
  }
}

export interface IcmInput {
  /**
   * Chip stack per player, in arbitrary order. Negative and zero stacks
   * are treated as 0, and those players' equity falls out as 0 naturally.
   */
  stacks: number[];
  /**
   * Prize amounts in descending order (largest first). If there are fewer
   * prizes than players, players beyond the prize count simply earn 0
   * expected value.
   */
  prizes: number[];
}

/**
 * Returns each player's ICM equity, index-aligned with `stacks`.
 *
 * The returned equities sum to the sum of `prizes` (within floating-point
 * tolerance) whenever at least one player has chips.
 *
 * @throws {IcmFieldTooLargeError} if `stacks.length` exceeds {@link MAX_PLAYERS}.
 */
export function calculateIcmEquity({ stacks, prizes }: IcmInput): number[] {
  const n = stacks.length;
  if (n === 0) return [];
  if (n > MAX_PLAYERS) throw new IcmFieldTooLargeError(n);

  // Defensive normalisation: clamp stacks and prizes to non-negative.
  // Mismatched-length prize arrays are handled by treating missing slots
  // as 0.
  const cleanStacks = stacks.map((s) => Math.max(0, Number(s) || 0));
  const cleanPrizes = prizes.map((p) => Math.max(0, Number(p) || 0));

  const total = cleanStacks.reduce((a, b) => a + b, 0);
  if (total <= 0) return new Array(n).fill(0);
  if (cleanPrizes.length === 0) return new Array(n).fill(0);

  return icmRecursive(cleanStacks, cleanPrizes, total);
}

function icmRecursive(stacks: number[], prizes: number[], total: number): number[] {
  const n = stacks.length;
  const equities: number[] = new Array(n).fill(0);
  const [firstPrize, ...remainingPrizes] = prizes;

  for (let i = 0; i < n; i++) {
    if (stacks[i] <= 0) continue;
    const probWinsThisPlace = stacks[i] / total;
    equities[i] += probWinsThisPlace * firstPrize;

    if (remainingPrizes.length === 0) continue;

    // Recurse on the sub-pool that excludes player i, tracking the
    // mapping back to original indices.
    const subStacks: number[] = [];
    const indexMap: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      subStacks.push(stacks[j]);
      indexMap.push(j);
    }
    const subTotal = total - stacks[i];
    if (subTotal <= 0) continue;

    const subEquities = icmRecursive(subStacks, remainingPrizes, subTotal);
    for (let k = 0; k < subEquities.length; k++) {
      equities[indexMap[k]] += probWinsThisPlace * subEquities[k];
    }
  }

  return equities;
}

/**
 * Convenience wrapper for rendering an ICM deal: returns each player with
 * an added `equity`, sorted by chip count descending.
 *
 * Generic over the player shape — anything with a numeric `stack` works,
 * and every other field is passed through untouched.
 */
export function buildIcmSplitTable<T extends { stack: number }>(
  players: T[],
  prizes: number[],
): Array<T & { equity: number }> {
  const stacks = players.map((p) => p.stack);
  const equities = calculateIcmEquity({ stacks, prizes });
  return players
    .map((p, i) => ({ ...p, equity: equities[i] ?? 0 }))
    .sort((a, b) => b.stack - a.stack);
}

export interface IcmSplitResult {
  /**
   * False until at least two players have chips. A one-player "deal" is
   * not a deal — the lone stack simply takes the top prize — so UIs
   * generally want to show a hint rather than a table of zeros.
   */
  enabled: boolean;
  values: number[];
}

/**
 * ICM equity with a guard for the degenerate sub-two-player case, for
 * driving a live deal calculator.
 */
export function computeIcmSplit(stacks: number[], payouts: number[]): IcmSplitResult {
  const activeCount = stacks.filter((chips) => chips > 0).length;
  if (activeCount < 2) {
    return { enabled: false, values: stacks.map(() => 0) };
  }
  return { enabled: true, values: calculateIcmEquity({ stacks, prizes: payouts }) };
}
