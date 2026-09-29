// Per-player counters. Scope: 'all' | 'd:<dayKey>' | 'w:<weekKey>' | 's:<seasonId>'. Metric keys: see plan §5.
import type { Clock } from '../../core/clock.js';
import { dayKey, weekKey } from '../../core/time.js';
import { prepare, type DbCtx } from '../database.js';

/** Context needed to compute default scopes (GameContext satisfies it). */
export interface ScopeCtx extends DbCtx {
  clock: Clock;
  config: { readonly timezone: string };
}

export const SCOPE_ALL = 'all';
export const scopeDay = (key: string): string => `d:${key}`;
export const scopeWeek = (key: string): string => `w:${key}`;
export const scopeSeason = (seasonId: number): string => `s:${seasonId}`;

/** id of the season with status 'active', or null. */
export function activeSeasonId(ctx: DbCtx): number | null {
  const r = prepare(ctx.db, "SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  return r?.id ?? null;
}

/** Current day/week/season scopes (season scope omitted when no active season). */
export function defaultScopes(ctx: ScopeCtx): string[] {
  const now = ctx.clock.now();
  const tz = ctx.config.timezone;
  const scopes = [SCOPE_ALL, scopeDay(dayKey(now, tz)), scopeWeek(weekKey(now, tz))];
  const season = activeSeasonId(ctx);
  if (season !== null) scopes.push(scopeSeason(season));
  return scopes;
}

/** Adds delta to the metric in every scope. */
export function inc(ctx: ScopeCtx, userId: string, metric: string, delta: number, scopes: string[] = defaultScopes(ctx)): void {
  const stmt = prepare(
    ctx.db,
    'INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, scope, metric) DO UPDATE SET value = value + excluded.value',
  );
  for (const s of scopes) stmt.run(userId, s, metric, delta);
}

/** Stores max(current, value) in every scope. */
export function max(ctx: ScopeCtx, userId: string, metric: string, value: number, scopes: string[] = defaultScopes(ctx)): void {
  const stmt = prepare(
    ctx.db,
    'INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, scope, metric) DO UPDATE SET value = MAX(value, excluded.value)',
  );
  for (const s of scopes) stmt.run(userId, s, metric, value);
}

/** Overwrites the metric in every scope (e.g. derived values like collection %). */
export function set(ctx: DbCtx, userId: string, metric: string, value: number, scopes: string[] = [SCOPE_ALL]): void {
  const stmt = prepare(
    ctx.db,
    'INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, scope, metric) DO UPDATE SET value = excluded.value',
  );
  for (const s of scopes) stmt.run(userId, s, metric, value);
}

export function get(ctx: DbCtx, userId: string, metric: string, scope: string = SCOPE_ALL): number {
  const r = prepare(ctx.db, 'SELECT value FROM stats WHERE user_id = ? AND scope = ? AND metric = ?').get(userId, scope, metric) as
    | { value: number }
    | undefined;
  return r?.value ?? 0;
}

/** All metrics of a user in one scope. */
export function getAll(ctx: DbCtx, userId: string, scope: string = SCOPE_ALL): Record<string, number> {
  const rows = prepare(ctx.db, 'SELECT metric, value FROM stats WHERE user_id = ? AND scope = ?').all(userId, scope) as { metric: string; value: number }[];
  return Object.fromEntries(rows.map((r) => [r.metric, r.value]));
}

export interface TopRow {
  userId: string;
  value: number;
}

/** Leaderboard: highest values first (ties: user_id asc for stability). Rows with value <= 0 are excluded. */
export function top(ctx: DbCtx, metric: string, scope: string, limit = 10): TopRow[] {
  return prepare(
    ctx.db,
    'SELECT user_id AS userId, value FROM stats WHERE scope = ? AND metric = ? AND value > 0 ORDER BY value DESC, user_id ASC LIMIT ?',
  ).all(scope, metric, limit) as TopRow[];
}

/** 1-based rank of the user for metric/scope, or null if they have no positive value. */
export function rank(ctx: DbCtx, userId: string, metric: string, scope: string): number | null {
  const v = prepare(ctx.db, 'SELECT value FROM stats WHERE user_id = ? AND scope = ? AND metric = ?').get(userId, scope, metric) as
    | { value: number }
    | undefined;
  if (!v || v.value <= 0) return null;
  const r = prepare(
    ctx.db,
    'SELECT COUNT(*) AS n FROM stats WHERE scope = ? AND metric = ? AND (value > ? OR (value = ? AND user_id < ?))',
  ).get(scope, metric, v.value, v.value, userId) as { n: number };
  return r.n + 1;
}

/**
 * `pearls_earned` (default scopes) for pearls credited outside the event-driven stats subscriber: grantReward,
 * first-catch pearls, /daily. Treasure pearls are counted by the subscriber from `treasure_found`.
 */
export function incPearlsEarned(ctx: ScopeCtx, userId: string, pearls: number): void {
  if (pearls > 0) inc(ctx, userId, 'pearls_earned', pearls);
}
