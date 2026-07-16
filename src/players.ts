/**
 * Shared player/table input shapes.
 *
 * Inputs are deliberately permissive. Real tournament state arrives from
 * databases, spreadsheets and wire formats where `table` might be the
 * string `"3"`, `seat` might be null, and names arrive split or whole. A
 * library that demands a pristine shape just pushes an adapter onto every
 * caller.
 */

export interface BalancePlayer {
  id: string;
  /** Whole display name. Takes precedence over `firstName`/`lastName`. */
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /**
   * A status of `'out'` (case-insensitive) excludes the player from every
   * count and plan. Every other status — seated, pending, registered, or
   * absent entirely — counts as live.
   */
  status?: string | null;
  table?: number | string | null;
  seat?: number | string | null;
}

export interface TableConfigEntry {
  /** Seats at this table. @default 10 */
  seats?: number | null;
  /** Disabled tables are excluded from balancing and seat capacity. */
  disabled?: boolean | null;
}

export type TableConfig<T extends TableConfigEntry = TableConfigEntry> = Record<string | number, T>;

export const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const isOut = (player: { status?: string | null }): boolean =>
  String(player?.status ?? '')
    .trim()
    .toLowerCase() === 'out';

/** `name`, else `firstName lastName`, else a stable placeholder. */
export const resolvePlayerName = (player: BalancePlayer): string => {
  const whole = String(player?.name ?? '').trim();
  if (whole) return whole;
  const joined = `${player?.firstName ?? ''} ${player?.lastName ?? ''}`.trim();
  return joined || 'Player';
};

/** Active (non-disabled) table ids in ascending order. */
export const activeTableIdsFrom = (tableConfig: TableConfig<TableConfigEntry>): number[] =>
  Object.keys(tableConfig ?? {})
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n > 0)
    .filter((t) => lookupTable(tableConfig, t)?.disabled !== true)
    .sort((a, b) => a - b);

/** Table config is keyed by number or numeric string depending on origin. */
export const lookupTable = <T extends TableConfigEntry>(
  cfg: TableConfig<T>,
  table: number,
): T | undefined => (cfg as Record<string | number, T>)[String(table)] ?? (cfg as Record<string | number, T>)[table];

export const DEFAULT_SEATS = 10;

export const seatCapacity = (cfg: TableConfig<TableConfigEntry>, table: number): number => {
  const seats = lookupTable(cfg, table)?.seats;
  return typeof seats === 'number' && seats > 0 ? seats : DEFAULT_SEATS;
};
