import type { LocationId } from '../../data/types.js';
import { prepare, type DbCtx } from '../database.js';

export interface PlayerRow {
  user_id: string;
  username: string;
  created_at: number;
  level: number;
  /** XP progress inside the current level (resets on level-up, see game/levels.ts) */
  xp: number;
  /** raw stored energy; the current value is computed lazily by WP2 (game/energy.ts) */
  energy: number;
  energy_updated_at: number;
  coins: number;
  pearls: number;
  cage_capacity: number;
  daily_streak: number;
  last_daily_key: string | null;
  drinks_day_key: string | null;
  drinks_used: number;
  bj_day_key: string | null;
  bj_hands: number;
  pity_silver: number;
  pity_gold: number;
  location: LocationId;
  active_title: string | null;
  active_frame: string | null;
  active_background: string | null;
}

/** Columns updatable through `updatePlayer`. Coins/pearls must go through repos/wallet. */
export type PlayerUpdatable = Omit<PlayerRow, 'user_id' | 'created_at' | 'coins' | 'pearls'>;

const UPDATABLE = new Set<keyof PlayerUpdatable>([
  'username',
  'level',
  'xp',
  'energy',
  'energy_updated_at',
  'cage_capacity',
  'daily_streak',
  'last_daily_key',
  'drinks_day_key',
  'drinks_used',
  'bj_day_key',
  'bj_hands',
  'pity_silver',
  'pity_gold',
  'location',
  'active_title',
  'active_frame',
  'active_background',
]);

export function getPlayer(ctx: DbCtx, userId: string): PlayerRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM players WHERE user_id = ?').get(userId) as PlayerRow | undefined;
}

/** Like getPlayer but throws if missing. */
export function requirePlayer(ctx: DbCtx, userId: string): PlayerRow {
  const p = getPlayer(ctx, userId);
  if (!p) throw new Error(`Player not found: ${userId}`);
  return p;
}

/** Inserts a new player row (fails if it exists). Prefer services/player.getOrCreatePlayer. */
export function createPlayer(ctx: DbCtx, userId: string, username: string, energy: number, now: number, cageCapacity?: number): PlayerRow {
  prepare(
    ctx.db,
    'INSERT INTO players (user_id, username, created_at, energy, energy_updated_at, cage_capacity) VALUES (?, ?, ?, ?, ?, COALESCE(?, 50))',
  ).run(userId, username, now, energy, now, cageCapacity ?? null);
  return requirePlayer(ctx, userId);
}

/** Updates the given columns (whitelisted). No-op for an empty patch. */
export function updatePlayer(ctx: DbCtx, userId: string, fields: Partial<PlayerUpdatable>): void {
  const keys = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined) as (keyof PlayerUpdatable)[];
  if (keys.length === 0) return;
  for (const k of keys) if (!UPDATABLE.has(k)) throw new Error(`updatePlayer: column not updatable: ${String(k)}`);
  const sql = `UPDATE players SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`;
  const values = keys.map((k) => fields[k] as unknown);
  const r = prepare(ctx.db, sql).run(...values, userId);
  if (r.changes === 0) throw new Error(`Player not found: ${userId}`);
}

/** Raw energy setter (WP2 computes the lazy value). */
export function setEnergy(ctx: DbCtx, userId: string, energy: number, updatedAt: number): void {
  updatePlayer(ctx, userId, { energy, energy_updated_at: updatedAt });
}

export function listPlayerIds(ctx: DbCtx): string[] {
  return (prepare(ctx.db, 'SELECT user_id FROM players ORDER BY created_at').all() as { user_id: string }[]).map((r) => r.user_id);
}

export function countPlayers(ctx: DbCtx): number {
  return (prepare(ctx.db, 'SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
}

/** Top players by level then xp (for the "level" leaderboard). */
export function topByLevel(ctx: DbCtx, limit = 10): Pick<PlayerRow, 'user_id' | 'username' | 'level' | 'xp'>[] {
  return prepare(ctx.db, 'SELECT user_id, username, level, xp FROM players ORDER BY level DESC, xp DESC, created_at ASC LIMIT ?').all(limit) as Pick<
    PlayerRow,
    'user_id' | 'username' | 'level' | 'xp'
  >[];
}
