# @pokerhawk/tournament-math

[![CI](https://github.com/TourneyTek-Inc/tournament-math/actions/workflows/ci.yml/badge.svg)](https://github.com/TourneyTek-Inc/tournament-math/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pokerhawk/tournament-math.svg)](https://www.npmjs.com/package/@pokerhawk/tournament-math)
[![types](https://img.shields.io/badge/types-included-3178C6.svg)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The math behind running a live poker tournament: **ICM equity**, **payout curves**, **table balancing**, **close-table seat planning**, and **stack pressure**.

Zero dependencies. Pure functions — no I/O, no framework, no globals. Ships ESM + CJS with types.

Extracted from [Poker Hawk](https://www.pokerhawk.io), where it runs real tournaments in real rooms.

```bash
npm install @pokerhawk/tournament-math
```

## Why this exists

Tournament software keeps re-deriving the same handful of algorithms, usually inside a UI component, usually untested, and usually subtly wrong at the edges — a payout table that loses a dollar to rounding, a balance suggestion that moves the wrong player, an ICM call that hangs the tab on a full field.

These are the pure-logic pieces pulled out of a shipping product and tested on their own.

## ICM

Independent Chip Model equity by [Malmuth-Harville](https://en.wikipedia.org/wiki/Independent_Chip_Model) recursion — the standard basis for a chip-weighted deal at the final table.

```ts
import { calculateIcmEquity } from '@pokerhawk/tournament-math';

// Chip leader holds 75% of chips, but nothing close to 75% of the money.
calculateIcmEquity({ stacks: [75, 25], prizes: [70, 30] });
// → [60, 40]
```

Equities are index-aligned with `stacks` and always sum to the sum of `prizes`.

**ICM is factorial in the field size.** Ten players is milliseconds; fifteen is minutes; twenty outlives the tournament. Rather than appearing to hang, this throws `IcmFieldTooLargeError` above `MAX_PLAYERS` (12). ICM is a final-table tool — filter to the players still in contention first.

```ts
import { buildIcmSplitTable } from '@pokerhawk/tournament-math';

// Generic over your player shape; extra fields pass through untouched.
buildIcmSplitTable(
  [
    { id: 'b', displayName: 'Bea', stack: 3000 },
    { id: 'a', displayName: 'Al', stack: 6000 },
  ],
  [100, 60],
);
// → sorted by stack, descending:
// [ { id: 'a', displayName: 'Al',  stack: 6000, equity: 86.67 },
//   { id: 'b', displayName: 'Bea', stack: 3000, equity: 73.33 } ]
```

## Payouts

Split a prize pool across paid places with three curve shapes.

```ts
import { calculatePayouts } from '@pokerhawk/tournament-math';

calculatePayouts({ totalPot: 1000, payoutCount: 3, formula: 'standard' });
// → [{ place: 1, amount: 482 }, { place: 2, amount: 314 }, { place: 3, amount: 204 }]

calculatePayouts({ totalPot: 100, payoutCount: 3, formula: 'flat' });
// → [{ place: 1, amount: 34 }, { place: 2, amount: 33 }, { place: 3, amount: 33 }]
```

| Formula | Shape |
| --- | --- |
| `standard` | Geometric decay, factor 0.65 |
| `topHeavy` | Geometric decay, factor 0.45 — rewards the win harder |
| `flat` | Every place paid equally |

**The amounts always sum to exactly `totalPot`** for every formula and every place count, given an integer pot. Rounding remainder is reconciled explicitly rather than left to float drift — money that quietly evaporates between the pot and the payout table is the kind of bug players notice at the cage.

Work in minor units (cents) if you need sub-unit precision; the integer-exactness guarantee is defined for integer pots.

## Table balancing

As the field shrinks, tables drift out of balance. This computes what to move.

```ts
import { computeTableBalance } from '@pokerhawk/tournament-math';

const result = computeTableBalance({
  players: [
    { id: 'p1', name: 'Al', table: 1, seat: 1 },
    { id: 'p2', name: 'Bea', table: 1, seat: 2 },
    { id: 'p3', name: 'Cy', table: 1, seat: 3 },
    { id: 'p4', name: 'Di', table: 2, seat: 1 },
    { id: 'p5', name: 'Ed', table: 2, seat: 2, status: 'out' },
  ],
  tableConfig: { 1: { seats: 9 }, 2: { seats: 9 } },
});

result.tableCounts; // { 1: 3, 2: 1 } — busted players don't count
result.suggestedMoves; // [{ fromTable: 1, toTable: 2, playerId: 'p3', playerName: 'Cy' }]
result.suggestedCloseTable; // 2
```

Greedy surplus → deficit matching, moving the last-seated player at each surplus table. Deterministic: the same state yields the same suggestions regardless of input ordering, so it's safe to call from a render path.

`suggestedCloseTable` is the emptiest table whose players the remaining tables can actually absorb, or `null`.

## Close-table planning

Break a table without over-seating a survivor.

```ts
import { computeCloseTablePlan } from '@pokerhawk/tournament-math';

const plan = computeCloseTablePlan({
  closeTable: 3,
  mode: 'moveClosingOnly', // or 'reseatAll'
  players,
  tableConfig: { 1: { seats: 9 }, 2: { seats: 9, dealerPlaying: true }, 3: { seats: 9 } },
});

plan.plannedMoves; // [{ player, toTable, toSeat }, …] — apply in order
plan.canExecute; // false when the remaining tables can't absorb everyone
plan.reason; // human-readable explanation when they can't
```

| Mode | Behaviour |
| --- | --- |
| `moveClosingOnly` | Preserve seating elsewhere; relocate only the closing table, emptiest destination first |
| `reseatAll` | Unseat everyone and redistribute evenly — for when the field has stratified |

Seat assignment is shuffled, because deterministic seating reads as favouritism in a live room. Pass a seeded `rng` when you need reproducible plans:

```ts
computeCloseTablePlan({ ...args, rng: mulberry32(42) }); // same plan every time
```

Tables with `dealerPlaying: true` keep the dealer's seat free (`dealerPosition: 'first' | 'last'`, default `'last'`).

## Stack pressure

```ts
import { computeStackPressure } from '@pokerhawk/tournament-math';

computeStackPressure({ chips: 10_500, sb: 100, bb: 200, ante: 25, playersInHand: 9 });
// → { bbCount: 52.5, mRatio: 20, zone: 'Green' }
```

Harrington's M — orbits survivable while folding every hand — alongside big-blind count, bucketed into `Green | Yellow | Orange | Red`. The zone takes whichever measure is more pessimistic, since a large ante flatters BB count relative to how the stack actually plays.

## Input shapes are permissive on purpose

Real tournament state arrives from databases, spreadsheets and wire formats. `table` might be the string `"3"`. `seat` might be `null`. Names arrive whole (`name`) or split (`firstName`/`lastName`). A library that demands a pristine shape just pushes an adapter onto every caller, so these functions coerce instead:

- Any player with `status: 'out'` (any casing) is excluded from counts, moves and plans. Every other status counts as live.
- Players without a valid table and seat are ignored rather than throwing.
- `tableConfig` is optional — tables are inferred from the players, defaulting to `DEFAULT_SEATS` (10).
- Disabled tables (`disabled: true`) drop out entirely.

The one thing that throws is an ICM field too large to compute, because silently taking forever is worse than a clear error.

## License

MIT © [TourneyTek, Inc.](https://www.pokerhawk.io)
