/**
 * Close-table seat planning.
 *
 * Computes the sequence of seat moves needed to break a table without
 * over-seating any survivor, with two strategies:
 *
 *   - **moveClosingOnly** — preserve seating elsewhere; relocate only the
 *     players at the closing table, filling the emptiest tables first.
 *   - **reseatAll** — unseat everyone and redistribute evenly across the
 *     remaining tables. Useful when the field has stratified and a
 *     rebalance is overdue anyway.
 *
 * Seat assignment is shuffled (Fisher-Yates) so the same player doesn't
 * deterministically land in the same downstream seat every time a table
 * breaks — in a live room that reads as favouritism. Pass a seeded `rng`
 * for reproducible plans (tests, previews, replays).
 */

import {
  activeTableIdsFrom,
  isOut,
  lookupTable,
  resolvePlayerName,
  seatCapacity,
  toFiniteNumber,
  type BalancePlayer,
  type TableConfig,
  type TableConfigEntry,
} from './players.js';

export type CloseTableMode = 'moveClosingOnly' | 'reseatAll';

export interface CloseTableConfigEntry extends TableConfigEntry {
  /** When true, a seat is reserved for a non-playing dealer. */
  dealerPlaying?: boolean | null;
  /** Which seat the dealer occupies. @default 'last' */
  dealerPosition?: 'first' | 'last' | null;
}

export type CloseTableConfig = TableConfig<CloseTableConfigEntry>;

export interface CloseSeatedPlayer {
  id: string;
  name: string;
  table: number;
  seat: number;
}

export interface PlannedMove {
  player: CloseSeatedPlayer;
  toTable: number;
  toSeat: number;
}

export interface CloseTablePlan {
  /** Seat reassignments to apply, in order. Empty when nothing must move. */
  plannedMoves: PlannedMove[];
  /** Live players currently at the closing table. */
  closingPlayerCount: number;
  /** Active tables minus the one being closed, ascending. */
  remainingTables: number[];
  /**
   * True when the plan seats every mover. False means the remaining
   * tables can't absorb everyone — raise seat caps or close a different
   * table.
   */
  canExecute: boolean;
  /** Human-readable explanation when `canExecute` is false. */
  reason: string | null;
}

export interface ComputeCloseTablePlanInput {
  /** Table number to break. */
  closeTable: number;
  mode: CloseTableMode;
  players: BalancePlayer[];
  tableConfig?: CloseTableConfig;
  /** Injectable RNG for deterministic plans. @default Math.random */
  rng?: () => number;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function computeCloseTablePlan(args: ComputeCloseTablePlanInput): CloseTablePlan {
  const rng = args.rng ?? Math.random;
  const { closeTable, mode } = args;
  const players = Array.isArray(args.players) ? args.players : [];
  const tableCfg = args.tableConfig ?? {};

  const activeIds = activeTableIdsFrom(tableCfg);

  const seatCap: Record<number, number> = {};
  const dealerSeatByTable: Record<number, number | null> = {};
  for (const t of activeIds) {
    const cap = seatCapacity(tableCfg, t);
    seatCap[t] = cap;
    const tc = lookupTable(tableCfg, t);
    dealerSeatByTable[t] = tc?.dealerPlaying ? (tc?.dealerPosition === 'first' ? 1 : cap) : null;
  }

  const seatedPlayers: CloseSeatedPlayer[] = [];
  for (const p of players) {
    if (!p || typeof p !== 'object') continue;
    if (isOut(p)) continue;
    const id = String(p.id ?? '').trim();
    if (!id) continue;
    const t = toFiniteNumber(p.table);
    if (t == null || t <= 0) continue;
    const seat = toFiniteNumber(p.seat);
    if (seat == null || seat <= 0) continue;
    seatedPlayers.push({ id, name: resolvePlayerName(p), table: t, seat });
  }

  const playersByTable: Record<number, CloseSeatedPlayer[]> = {};
  for (const sp of seatedPlayers) {
    (playersByTable[sp.table] ??= []).push(sp);
  }
  for (const t of Object.keys(playersByTable).map(Number)) {
    playersByTable[t].sort((a, b) => a.seat - b.seat || a.name.localeCompare(b.name));
  }

  const closingPlayers = closeTable > 0 ? (playersByTable[closeTable] ?? []) : [];
  const remainingTables = activeIds.filter((t) => t !== closeTable);

  // Build each table's open-seat list. moveClosingOnly preserves current
  // occupants; reseatAll frees every seat.
  const openSeatsByTable: Record<number, number[]> = {};
  for (const t of remainingTables) {
    const cap = seatCap[t] ?? 0;
    const dealerSeat = dealerSeatByTable[t];
    const occupied = new Set<number>(
      mode === 'reseatAll' ? [] : (playersByTable[t] ?? []).map((sp) => sp.seat),
    );
    const seats: number[] = [];
    for (let s = 1; s <= cap; s++) {
      if (dealerSeat != null && s === dealerSeat) continue;
      if (occupied.has(s)) continue;
      seats.push(s);
    }
    openSeatsByTable[t] = seats;
  }

  // Sort before shuffling so the shuffle is the only source of
  // nondeterminism — a seeded rng then yields a fully reproducible plan
  // regardless of input ordering.
  const moversBase = mode === 'reseatAll' ? seatedPlayers.slice() : closingPlayers.slice();
  const movers = shuffleInPlace(
    moversBase.sort((a, b) => a.name.localeCompare(b.name) || a.table - b.table || a.seat - b.seat),
    rng,
  );

  const openCopy: Record<number, number[]> = {};
  for (const t of remainingTables) {
    openCopy[t] = shuffleInPlace((openSeatsByTable[t] ?? []).slice(), rng);
  }

  const counts: Record<number, number> = {};
  for (const t of remainingTables) {
    counts[t] = mode === 'reseatAll' ? 0 : (playersByTable[t]?.length ?? 0);
  }

  // Fill the emptiest table first, breaking ties randomly so repeated
  // breaks don't always favour the lowest-numbered table.
  const pickTable = (): number | undefined => {
    const candidates = remainingTables.filter((t) => (openCopy[t] ?? []).length > 0);
    if (!candidates.length) return undefined;
    const minCount = Math.min(...candidates.map((t) => counts[t] ?? 0));
    const tied = candidates.filter((t) => (counts[t] ?? 0) === minCount);
    return tied[Math.floor(rng() * tied.length)];
  };

  const plannedMoves: PlannedMove[] = [];
  for (const p of movers) {
    const t = pickTable();
    if (t == null) break;
    const seat = openCopy[t].shift();
    if (typeof seat !== 'number') break;
    plannedMoves.push({ player: p, toTable: t, toSeat: seat });
    counts[t] = (counts[t] ?? 0) + 1;
  }

  const moverCount = movers.length;
  const canExecute = moverCount === 0 ? remainingTables.length > 0 : plannedMoves.length === moverCount;

  let reason: string | null = null;
  if (!canExecute) {
    reason =
      remainingTables.length === 0
        ? 'No remaining tables to absorb players.'
        : 'Not enough open seats on the remaining tables.';
  }

  return {
    plannedMoves,
    closingPlayerCount: closingPlayers.length,
    remainingTables,
    canExecute,
    reason,
  };
}
