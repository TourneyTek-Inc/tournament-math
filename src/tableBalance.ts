/**
 * Table-balance suggestions.
 *
 * As a tournament field shrinks, tables drift out of balance and the
 * floor has to move players. This computes what to move, using greedy
 * surplus → deficit matching with the last-seated player at each surplus
 * table as the move candidate, and identifies when a table can be closed
 * outright.
 *
 * Pure function: no side effects, no I/O, deterministic. Safe to call
 * from a render path or a `useMemo`.
 */

import {
  activeTableIdsFrom,
  isOut,
  resolvePlayerName,
  seatCapacity,
  toFiniteNumber,
  type BalancePlayer,
  type TableConfig,
  type TableConfigEntry,
} from './players.js';

export type BalanceTableConfigEntry = TableConfigEntry;
export type BalanceTableConfig = TableConfig<TableConfigEntry>;
export type { BalancePlayer };

export interface SuggestedMove {
  fromTable: number;
  toTable: number;
  playerId?: string;
  playerName?: string;
}

export interface BalanceResult {
  /**
   * All non-disabled tables in ascending order. Derived from
   * `tableConfig` when present, otherwise from the distinct tables the
   * players actually sit at.
   */
  activeTableIds: number[];
  /** Count of live (non-`out`) players per active table. */
  tableCounts: Record<number, number>;
  /** Total of `tableCounts` across all active tables. */
  totalSeated: number;
  /** Target floor: `floor(totalSeated / activeTableCount)`. */
  targetMin: number;
  /** Target ceiling: `targetMin + 1` when the split is uneven, else `targetMin`. */
  targetMax: number;
  /** Greedy surplus → deficit pairings, in application order. */
  suggestedMoves: SuggestedMove[];
  /**
   * Lowest-count closeable table, if any. Closeable means the remaining
   * tables' seats can absorb every live player, and more than one table
   * is active.
   */
  suggestedCloseTable: number | null;
  /** Per-table closeable flag, for rendering Close affordances. */
  closeableByTable: Record<number, boolean>;
}

export interface ComputeTableBalanceInput {
  players: BalancePlayer[];
  /**
   * Seats and disabled state per table. May be omitted entirely, in which
   * case tables are inferred from the players and every table is assumed
   * to have {@link DEFAULT_SEATS} seats.
   */
  tableConfig?: BalanceTableConfig;
}

interface SeatedEntry {
  id: string;
  name: string;
  seat: number;
}

export function computeTableBalance(args: ComputeTableBalanceInput): BalanceResult {
  const players = Array.isArray(args.players) ? args.players : [];
  const tableCfg = args.tableConfig ?? {};

  const cfgIds = activeTableIdsFrom(tableCfg);

  // Fall back to the tables the players sit at when no config is given —
  // this happens early in setup, before tables are saved.
  const derivedIds = Array.from(
    new Set(
      players
        .filter((p) => p && !isOut(p))
        .map((p) => toFiniteNumber(p?.table))
        .filter((n): n is number => n != null && n > 0),
    ),
  ).sort((a, b) => a - b);

  const activeIds = cfgIds.length ? cfgIds : derivedIds;

  const seatCap: Record<number, number> = {};
  for (const t of activeIds) seatCap[t] = seatCapacity(tableCfg, t);

  const playersByTable: Record<number, SeatedEntry[]> = {};
  for (const t of activeIds) playersByTable[t] = [];

  for (const p of players) {
    if (!p || typeof p !== 'object') continue;
    if (isOut(p)) continue;

    const id = String(p.id ?? '').trim();
    if (!id) continue;

    const tableNum = toFiniteNumber(p.table);
    if (tableNum == null || tableNum <= 0) continue;

    const seatNum = toFiniteNumber(p.seat);
    if (seatNum == null || seatNum <= 0) continue;

    // A player parked at a table that isn't active (disabled, or absent
    // from the config) is not part of the balance picture.
    if (!activeIds.includes(tableNum)) continue;

    playersByTable[tableNum].push({ id, name: resolvePlayerName(p), seat: seatNum });
  }

  // Sort by seat, then name, so "last-seated player" is deterministic
  // across renders rather than dependent on input order.
  const counts: Record<number, number> = {};
  for (const t of activeIds) {
    playersByTable[t].sort((a, b) => a.seat - b.seat || a.name.localeCompare(b.name));
    counts[t] = playersByTable[t].length;
  }

  const total = activeIds.reduce((sum, t) => sum + (counts[t] ?? 0), 0);

  const capacityWithout = (closeTable: number) =>
    activeIds
      .filter((t) => t !== closeTable)
      .reduce((sum, t) => sum + (seatCap[t] ?? 0), 0);

  const canCloseTable = (closeTable: number) => {
    if (!activeIds.includes(closeTable)) return false;
    if (activeIds.length <= 1) return false;
    return total <= capacityWithout(closeTable);
  };

  const closeable: Record<number, boolean> = {};
  for (const t of activeIds) closeable[t] = canCloseTable(t);

  const suggestedClose =
    activeIds
      .slice()
      .sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0) || a - b)
      .find((t) => closeable[t]) ?? null;

  const tableCount = Math.max(activeIds.length, 1);
  const base = Math.floor(total / tableCount);
  const remainder = total % tableCount;
  const targetMin = base;
  const targetMax = base + (remainder > 0 ? 1 : 0);

  // The first `remainder` tables absorb the extra player; the rest target
  // `base`. Stable order keeps suggested moves deterministic.
  const shouldBeMax = new Set(activeIds.slice(0, remainder));

  const surplus: { table: number; extra: number }[] = [];
  const deficit: { table: number; need: number }[] = [];

  for (const t of activeIds) {
    const desired = shouldBeMax.has(t) ? base + 1 : base;
    const current = counts[t] ?? 0;
    if (current > desired) surplus.push({ table: t, extra: current - desired });
    if (current < desired) deficit.push({ table: t, need: desired - current });
  }

  const moves: SuggestedMove[] = [];
  const workingByTable: Record<number, SeatedEntry[]> = {};
  for (const t of activeIds) workingByTable[t] = playersByTable[t].slice();

  let sIdx = 0;
  let dIdx = 0;
  while (sIdx < surplus.length && dIdx < deficit.length) {
    const s = surplus[sIdx];
    const d = deficit[dIdx];

    const fromList = workingByTable[s.table] ?? [];
    const candidate = fromList.pop();

    moves.push({
      fromTable: s.table,
      toTable: d.table,
      playerId: candidate?.id,
      playerName: candidate?.name,
    });

    s.extra -= 1;
    d.need -= 1;
    if (s.extra <= 0) sIdx += 1;
    if (d.need <= 0) dIdx += 1;
  }

  return {
    activeTableIds: activeIds,
    tableCounts: counts,
    totalSeated: total,
    targetMin,
    targetMax,
    suggestedMoves: moves,
    suggestedCloseTable: suggestedClose,
    closeableByTable: closeable,
  };
}
