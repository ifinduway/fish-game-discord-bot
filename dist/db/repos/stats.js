import { dayKey, weekKey } from '../../core/time.js';
import { prepare } from '../database.js';
export const SCOPE_ALL = 'all';
export const scopeDay = (key) => `d:${key}`;
export const scopeWeek = (key) => `w:${key}`;
export const scopeSeason = (seasonId) => `s:${seasonId}`;
/** id of the season with status 'active', or null. */
export function activeSeasonId(ctx) {
    const r = prepare(ctx.db, "SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
    return r?.id ?? null;
}
/** Current day/week/season scopes (season scope omitted when no active season). */
export function defaultScopes(ctx) {
    const now = ctx.clock.now();
    const tz = ctx.config.timezone;
    const scopes = [SCOPE_ALL, scopeDay(dayKey(now, tz)), scopeWeek(weekKey(now, tz))];
    const season = activeSeasonId(ctx);
    if (season !== null)
        scopes.push(scopeSeason(season));
    return scopes;
}
/** Adds delta to the metric in every scope. */
export function inc(ctx, userId, metric, delta, scopes = defaultScopes(ctx)) {
    const stmt = prepare(ctx.db, 'INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, scope, metric) DO UPDATE SET value = value + excluded.value');
    for (const s of scopes)
        stmt.run(userId, s, metric, delta);
}
/** Stores max(current, value) in every scope. */
export function max(ctx, userId, metric, value, scopes = defaultScopes(ctx)) {
    const stmt = prepare(ctx.db, 'INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, scope, metric) DO UPDATE SET value = MAX(value, excluded.value)');
    for (const s of scopes)
        stmt.run(userId, s, metric, value);
}
/** Overwrites the metric in every scope (e.g. derived values like collection %). */
export function set(ctx, userId, metric, value, scopes = [SCOPE_ALL]) {
    const stmt = prepare(ctx.db, 'INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, scope, metric) DO UPDATE SET value = excluded.value');
    for (const s of scopes)
        stmt.run(userId, s, metric, value);
}
export function get(ctx, userId, metric, scope = SCOPE_ALL) {
    const r = prepare(ctx.db, 'SELECT value FROM stats WHERE user_id = ? AND scope = ? AND metric = ?').get(userId, scope, metric);
    return r?.value ?? 0;
}
/** All metrics of a user in one scope. */
export function getAll(ctx, userId, scope = SCOPE_ALL) {
    const rows = prepare(ctx.db, 'SELECT metric, value FROM stats WHERE user_id = ? AND scope = ?').all(userId, scope);
    return Object.fromEntries(rows.map((r) => [r.metric, r.value]));
}
/** Leaderboard: highest values first (ties: user_id asc for stability). Rows with value <= 0 are excluded. */
export function top(ctx, metric, scope, limit = 10) {
    return prepare(ctx.db, 'SELECT user_id AS userId, value FROM stats WHERE scope = ? AND metric = ? AND value > 0 ORDER BY value DESC, user_id ASC LIMIT ?').all(scope, metric, limit);
}
/** 1-based rank of the user for metric/scope, or null if they have no positive value. */
export function rank(ctx, userId, metric, scope) {
    const v = prepare(ctx.db, 'SELECT value FROM stats WHERE user_id = ? AND scope = ? AND metric = ?').get(userId, scope, metric);
    if (!v || v.value <= 0)
        return null;
    const r = prepare(ctx.db, 'SELECT COUNT(*) AS n FROM stats WHERE scope = ? AND metric = ? AND (value > ? OR (value = ? AND user_id < ?))').get(scope, metric, v.value, v.value, userId);
    return r.n + 1;
}
//# sourceMappingURL=stats.js.map