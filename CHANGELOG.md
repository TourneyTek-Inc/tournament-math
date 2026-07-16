# Changelog

All notable changes to this project are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0

### Fixed

- **The ICM cost guard measured the wrong thing.** 0.1.0 capped the *player
  count* at 12, on the belief that ICM is factorial in the field size. It
  isn't: the recursion descends once per prize, so the cost is permutations
  `P(n, prizes)`. The old guard was wrong in both directions — it rejected 50
  players paying 3 places (117,600 permutations, **1.2 ms**) while happily
  accepting 12 players paying 12 places (479 million permutations, **44
  seconds**), which is the exact hang it was meant to prevent.

  The guard now caps permutations at `MAX_PERMUTATIONS` (5,000,000, ~0.5s).

### Changed (breaking)

- `MAX_PLAYERS` → `MAX_PERMUTATIONS`.
- `IcmFieldTooLargeError` → `IcmTooExpensiveError`, now carrying both
  `playerCount` and `prizeCount`, since neither alone explains the cost.
- Added `icmPermutationCount(players, prizes)` so callers can check the cost
  before committing to the call.

## 0.1.0

Initial release. Extracted from the Poker Hawk tournament platform, where
these functions run live events.

### Added

- `calculateIcmEquity`, `buildIcmSplitTable`, `computeIcmSplit` — ICM equity
  via Malmuth-Harville recursion, with a `MAX_PLAYERS` guard that throws
  `IcmFieldTooLargeError` rather than hanging on a factorial field.
- `calculatePayouts` — `standard` / `topHeavy` / `flat` prize curves, exact to
  the unit for integer pots.
- `computeTableBalance` — greedy surplus → deficit balancing with closeable
  table detection.
- `computeCloseTablePlan` — `moveClosingOnly` / `reseatAll` seat planning with
  an injectable RNG and dealer-seat reservation.
- `computeStackPressure` — big blinds, Harrington M, and pressure zones.
