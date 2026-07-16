import { describe, expect, it } from 'vitest';
import { computeTableBalance } from '../tableBalance.js';
import type { BalancePlayer } from '../players.js';

/** Seat `count` players at `table`, seats 1..count. */
const seat = (table: number, count: number, prefix = 't'): BalancePlayer[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${table}p${i + 1}`,
    name: `Player ${table}-${i + 1}`,
    table,
    seat: i + 1,
  }));

const CFG = { 1: { seats: 9 }, 2: { seats: 9 } };

describe('computeTableBalance', () => {
  it('counts live players per table and totals them', () => {
    const result = computeTableBalance({
      players: [...seat(1, 6), ...seat(2, 2)],
      tableConfig: CFG,
    });
    expect(result.tableCounts).toEqual({ 1: 6, 2: 2 });
    expect(result.totalSeated).toBe(8);
    expect(result.activeTableIds).toEqual([1, 2]);
  });

  it('targets an even split and moves the surplus', () => {
    const result = computeTableBalance({
      players: [...seat(1, 6), ...seat(2, 2)],
      tableConfig: CFG,
    });
    // 8 players / 2 tables = 4 each, so two must move from 1 to 2.
    expect(result.targetMin).toBe(4);
    expect(result.targetMax).toBe(4);
    expect(result.suggestedMoves).toHaveLength(2);
    for (const move of result.suggestedMoves) {
      expect(move.fromTable).toBe(1);
      expect(move.toTable).toBe(2);
      expect(move.playerId).toBeTruthy();
    }
  });

  it('allows a one-player spread when the field does not divide evenly', () => {
    const result = computeTableBalance({
      players: [...seat(1, 5), ...seat(2, 4)],
      tableConfig: CFG,
    });
    expect(result.targetMin).toBe(4);
    expect(result.targetMax).toBe(5);
    expect(result.suggestedMoves).toEqual([]);
  });

  it('suggests no moves when tables are already balanced', () => {
    const result = computeTableBalance({
      players: [...seat(1, 4), ...seat(2, 4)],
      tableConfig: CFG,
    });
    expect(result.suggestedMoves).toEqual([]);
  });

  it('moves the last-seated player, deterministically regardless of input order', () => {
    const players = [...seat(1, 6), ...seat(2, 2)];
    const forwards = computeTableBalance({ players, tableConfig: CFG });
    const backwards = computeTableBalance({ players: [...players].reverse(), tableConfig: CFG });

    expect(forwards.suggestedMoves).toEqual(backwards.suggestedMoves);
    // Table 1 seats 1..6, so seats 6 then 5 are the two to move.
    expect(forwards.suggestedMoves.map((m) => m.playerId)).toEqual(['t1p6', 't1p5']);
  });

  it('excludes busted players from counts and moves', () => {
    const players: BalancePlayer[] = [
      ...seat(1, 4),
      { id: 'busted', name: 'Gone', table: 1, seat: 5, status: 'out' },
      ...seat(2, 4),
    ];
    const result = computeTableBalance({ players, tableConfig: CFG });
    expect(result.tableCounts).toEqual({ 1: 4, 2: 4 });
    expect(result.suggestedMoves).toEqual([]);
  });

  it('treats status casing loosely', () => {
    const players: BalancePlayer[] = [
      ...seat(1, 2),
      { id: 'x', name: 'X', table: 1, seat: 3, status: 'OUT' },
      { id: 'y', name: 'Y', table: 1, seat: 4, status: ' Out ' },
    ];
    expect(computeTableBalance({ players, tableConfig: { 1: { seats: 9 } } }).totalSeated).toBe(2);
  });

  it('accepts stringly-typed tables and seats', () => {
    const players: BalancePlayer[] = [
      { id: 'a', name: 'A', table: '1', seat: '1' },
      { id: 'b', name: 'B', table: '1', seat: '2' },
      { id: 'c', name: 'C', table: '2', seat: '1' },
    ];
    const result = computeTableBalance({ players, tableConfig: CFG });
    expect(result.totalSeated).toBe(3);
    expect(result.tableCounts).toEqual({ 1: 2, 2: 1 });
  });

  it('ignores unseated players', () => {
    const players: BalancePlayer[] = [
      ...seat(1, 3),
      { id: 'waiting', name: 'Waiting', table: null, seat: null },
      { id: 'noseat', name: 'No seat', table: 2, seat: null },
    ];
    expect(computeTableBalance({ players, tableConfig: CFG }).totalSeated).toBe(3);
  });

  it('derives tables from players when no config is supplied', () => {
    const result = computeTableBalance({ players: [...seat(1, 3), ...seat(3, 1)] });
    expect(result.activeTableIds).toEqual([1, 3]);
    expect(result.totalSeated).toBe(4);
  });

  it('drops disabled tables and the players parked at them', () => {
    const result = computeTableBalance({
      players: [...seat(1, 3), ...seat(2, 2)],
      tableConfig: { 1: { seats: 9 }, 2: { seats: 9, disabled: true } },
    });
    expect(result.activeTableIds).toEqual([1]);
    expect(result.tableCounts).toEqual({ 1: 3 });
    expect(result.totalSeated).toBe(3);
  });

  it('flags a table as closeable only when the others can absorb the field', () => {
    const roomy = computeTableBalance({
      players: [...seat(1, 4), ...seat(2, 3)],
      tableConfig: CFG,
    });
    // 7 players, 9 seats left after closing either table.
    expect(roomy.suggestedCloseTable).toBe(2); // lowest count first
    expect(roomy.closeableByTable).toEqual({ 1: true, 2: true });

    const packed = computeTableBalance({
      players: [...seat(1, 6), ...seat(2, 6)],
      tableConfig: { 1: { seats: 6 }, 2: { seats: 6 } },
    });
    // 12 players cannot fit on one 6-seat table.
    expect(packed.suggestedCloseTable).toBeNull();
    expect(packed.closeableByTable).toEqual({ 1: false, 2: false });
  });

  it('never suggests closing the last table', () => {
    const result = computeTableBalance({ players: seat(1, 3), tableConfig: { 1: { seats: 9 } } });
    expect(result.suggestedCloseTable).toBeNull();
    expect(result.closeableByTable).toEqual({ 1: false });
  });

  it('handles an empty field', () => {
    const result = computeTableBalance({ players: [], tableConfig: CFG });
    expect(result.totalSeated).toBe(0);
    expect(result.suggestedMoves).toEqual([]);
    expect(result.targetMin).toBe(0);
  });

  it('falls back to a placeholder name rather than emitting "undefined undefined"', () => {
    const result = computeTableBalance({
      players: [...seat(1, 3), { id: 'anon', table: 1, seat: 4 }, ...seat(2, 1)],
      tableConfig: CFG,
    });
    const moved = result.suggestedMoves.find((m) => m.playerId === 'anon');
    expect(moved?.playerName).toBe('Player');
  });

  it('joins split name parts when no whole name is given', () => {
    // 4 players over 2 tables targets 2 each, so table 1's last-seated
    // player (seat 3) is the one that moves.
    const result = computeTableBalance({
      players: [
        { id: 'a', name: 'A', table: 1, seat: 1 },
        { id: 'b', name: 'B', table: 1, seat: 2 },
        { id: 'c', firstName: 'Split', lastName: 'Name', table: 1, seat: 3 },
        { id: 'd', name: 'D', table: 2, seat: 1 },
      ],
      tableConfig: CFG,
    });
    expect(result.suggestedMoves[0]?.playerId).toBe('c');
    expect(result.suggestedMoves[0]?.playerName).toBe('Split Name');
  });

  it('prefers a whole name over split name parts', () => {
    const result = computeTableBalance({
      players: [
        { id: 'a', name: 'A', table: 1, seat: 1 },
        { id: 'b', name: 'B', table: 1, seat: 2 },
        { id: 'c', name: 'Whole Name', firstName: 'Ignored', lastName: 'Ignored', table: 1, seat: 3 },
        { id: 'd', name: 'D', table: 2, seat: 1 },
      ],
      tableConfig: CFG,
    });
    expect(result.suggestedMoves[0]?.playerName).toBe('Whole Name');
  });
});
