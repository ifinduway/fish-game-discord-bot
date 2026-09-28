import { prepare } from '../database.js';
const UPDATABLE = new Set([
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
export function getPlayer(ctx, userId) {
    return prepare(ctx.db, 'SELECT * FROM players WHERE user_id = ?').get(userId);
}
/** Like getPlayer but throws if missing. */
export function requirePlayer(ctx, userId) {
    const p = getPlayer(ctx, userId);
    if (!p)
        throw new Error(`Player not found: ${userId}`);
    return p;
}
/** Inserts a new player row (fails if it exists). Prefer services/player.getOrCreatePlayer. */
export function createPlayer(ctx, userId, username, energy, now, cageCapacity) {
    prepare(ctx.db, 'INSERT INTO players (user_id, username, created_at, energy, energy_updated_at, cage_capacity) VALUES (?, ?, ?, ?, ?, COALESCE(?, 50))').run(userId, username, now, energy, now, cageCapacity ?? null);
    return requirePlayer(ctx, userId);
}
/** Updates the given columns (whitelisted). No-op for an empty patch. */
export function updatePlayer(ctx, userId, fields) {
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length === 0)
        return;
    for (const k of keys)
        if (!UPDATABLE.has(k))
            throw new Error(`updatePlayer: column not updatable: ${String(k)}`);
    const sql = `UPDATE players SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`;
    const values = keys.map((k) => fields[k]);
    const r = prepare(ctx.db, sql).run(...values, userId);
    if (r.changes === 0)
        throw new Error(`Player not found: ${userId}`);
}
/** Raw energy setter (WP2 computes the lazy value). */
export function setEnergy(ctx, userId, energy, updatedAt) {
    updatePlayer(ctx, userId, { energy, energy_updated_at: updatedAt });
}
export function listPlayerIds(ctx) {
    return prepare(ctx.db, 'SELECT user_id FROM players ORDER BY created_at').all().map((r) => r.user_id);
}
export function countPlayers(ctx) {
    return prepare(ctx.db, 'SELECT COUNT(*) AS n FROM players').get().n;
}
/** Top players by level then xp (for the "level" leaderboard). */
export function topByLevel(ctx, limit = 10) {
    return prepare(ctx.db, 'SELECT user_id, username, level, xp FROM players ORDER BY level DESC, xp DESC, created_at ASC LIMIT ?').all(limit);
}
//# sourceMappingURL=players.js.map