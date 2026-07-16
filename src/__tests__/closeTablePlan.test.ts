import { describe, expect, it } from 'vitest';
import { computeCloseTablePlan } from '../closeTablePlan.js';
import type { BalancePlayer } from '../players.js';

/** Deterministic PRNG so plans are reproducible in assertions. */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const seat = (table: number, count: number): BalancePlayer[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `t${table}p${i + 1}`,
    name: `Player ${table}-${i + 1}`,
    table,
    seat: i + 1,
  }));

const CFG = { 1: { seats: 9 }, 2: { seats: 9 }, 3: { seats: 9 } };

describe('computeCloseTablePlan', () => {
  it('relocates exactly the closing table in moveClosingOnly mode', () => {
    const plan = computeCloseTablePlan({
      closeTable: 3,
      mode: 'moveClosingOnly',
      players: [...seat(1, 4), ...seat(2, 4), ...seat(3, 2)],
      tableConfig: CFG,
      rng: mulberry32(1),
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.closingPlayerCount).toBe(2);
    expect(plan.remainingTables).toEqual([1, 2]);
    expect(plan.plannedMoves).toHaveLength(2);
    for (const move of plan.plannedMoves) {
      expect(move.player.table).toBe(3);
      expect(move.toTable).not.toBe(3);
    }
  });

  it('never assigns two movers the same destination seat', () => {
    const plan = computeCloseTablePlan({
      closeTable: 3,
      mode: 'moveClosingOnly',
      players: [...seat(1, 2), ...seat(2, 2), ...seat(3, 6)],
      tableConfig: CFG,
      rng: mulberry32(7),
    });

    const destinations = plan.plannedMoves.map((m) => `${m.toTable}:${m.toSeat}`);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it('never seats a mover on top of a player who is staying put', () => {
    const stayers = [...seat(1, 5), ...seat(2, 5)];
    const plan = computeCloseTablePlan({
      closeTable: 3,
      mode: 'moveClosingOnly',
      players: [...stayers, ...seat(3, 4)],
      tableConfig: CFG,
      rng: mulberry32(3),
    });

    const occupied = new Set(stayers.map((p) => `${p.table}:${p.seat}`));
    for (const move of plan.plannedMoves) {
      expect(occupied.has(`${move.toTable}:${move.toSeat}`)).toBe(false);
    }
  });

  it('reseats the whole field in reseatAll mode', () => {
    const plan = computeCloseTablePlan({
      closeTable: 3,
      mode: 'reseatAll',
      players: [...seat(1, 4), ...seat(2, 4), ...seat(3, 2)],
      tableConfig: CFG,
      rng: mulberry32(2),
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.plannedMoves).toHaveLength(10);
    const destinations = plan.plannedMoves.map((m) => `${m.toTable}:${m.toSeat}`);
    expect(new Set(destinations).size).toBe(10);
    for (const move of plan.plannedMoves) expect(move.toTable).not.toBe(3);
  });

  it('spreads the field evenly when reseating everyone', () => {
    const plan = computeCloseTablePlan({
      closeTable: 3,
      mode: 'reseatAll',
      players: [...seat(1, 4), ...seat(2, 4), ...seat(3, 2)],
      tableConfig: CFG,
      rng: mulberry32(9),
    });

    const perTable = new Map<number, number>();
    for (const m of plan.plannedMoves) perTable.set(m.toTable, (perTable.get(m.toTable) ?? 0) + 1);
    expect([...perTable.values()].sort()).toEqual([5, 5]);
  });

  it('is reproducible for a given seed and varies across seeds', () => {
    const run = (seed: number) =>
      computeCloseTablePlan({
        closeTable: 3,
        mode: 'moveClosingOnly',
        players: [...seat(1, 2), ...seat(2, 2), ...seat(3, 4)],
        tableConfig: CFG,
        rng: mulberry32(seed),
      }).plannedMoves.map((m) => `${m.player.id}->${m.toTable}:${m.toSeat}`);

    expect(run(42)).toEqual(run(42));
    // Different seeds should not produce identical seat assignments.
    expect(run(42)).not.toEqual(run(1337));
  });

  it('reports that it cannot execute when seats run out', () => {
    const plan = computeCloseTablePlan({
      closeTable: 2,
      mode: 'moveClosingOnly',
      players: [...seat(1, 5), ...seat(2, 4)],
      tableConfig: { 1: { seats: 6 }, 2: { seats: 6 } },
      rng: mulberry32(1),
    });

    expect(plan.canExecute).toBe(false);
    expect(plan.reason).toMatch(/not enough open seats/i);
    // It still plans what it can, rather than returning nothing.
    expect(plan.plannedMoves).toHaveLength(1);
  });

  it('reports that it cannot execute when no table remains', () => {
    const plan = computeCloseTablePlan({
      closeTable: 1,
      mode: 'moveClosingOnly',
      players: seat(1, 3),
      tableConfig: { 1: { seats: 9 } },
      rng: mulberry32(1),
    });

    expect(plan.canExecute).toBe(false);
    expect(plan.reason).toMatch(/no remaining tables/i);
    expect(plan.plannedMoves).toEqual([]);
  });

  it('keeps the dealer seat free', () => {
    const plan = computeCloseTablePlan({
      closeTable: 2,
      mode: 'reseatAll',
      players: [...seat(1, 1), ...seat(2, 5)],
      tableConfig: { 1: { seats: 6, dealerPlaying: true, dealerPosition: 'last' }, 2: { seats: 6 } },
      rng: mulberry32(5),
    });

    for (const move of plan.plannedMoves) expect(move.toSeat).not.toBe(6);
  });

  it('honours a dealer in the first seat', () => {
    const plan = computeCloseTablePlan({
      closeTable: 2,
      mode: 'reseatAll',
      players: [...seat(1, 1), ...seat(2, 4)],
      tableConfig: { 1: { seats: 6, dealerPlaying: true, dealerPosition: 'first' }, 2: { seats: 6 } },
      rng: mulberry32(5),
    });

    for (const move of plan.plannedMoves) expect(move.toSeat).not.toBe(1);
  });

  it('excludes busted players from the plan', () => {
    const plan = computeCloseTablePlan({
      closeTable: 2,
      mode: 'moveClosingOnly',
      players: [
        ...seat(1, 2),
        { id: 'live', name: 'Live', table: 2, seat: 1 },
        { id: 'busted', name: 'Busted', table: 2, seat: 2, status: 'out' },
      ],
      tableConfig: CFG,
      rng: mulberry32(1),
    });

    expect(plan.closingPlayerCount).toBe(1);
    expect(plan.plannedMoves.map((m) => m.player.id)).toEqual(['live']);
  });

  it('succeeds trivially when the closing table is already empty', () => {
    const plan = computeCloseTablePlan({
      closeTable: 3,
      mode: 'moveClosingOnly',
      players: [...seat(1, 3), ...seat(2, 3)],
      tableConfig: CFG,
      rng: mulberry32(1),
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.closingPlayerCount).toBe(0);
    expect(plan.plannedMoves).toEqual([]);
  });
});
