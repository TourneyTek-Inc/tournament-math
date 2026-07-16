# Changelog

All notable changes to this project are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
