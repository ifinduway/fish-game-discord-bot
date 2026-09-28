import { prepare } from '../database.js';
/** Known guild_config keys. Other WPs may use additional keys (document them). */
export const CONFIG_KEYS = {
    announceChannelId: 'announce_channel_id',
    timezone: 'timezone',
};
export function getConfig(ctx, key) {
    const row = prepare(ctx.db, 'SELECT value FROM guild_config WHERE key = ?').get(key);
    return row?.value ?? null;
}
export function setConfig(ctx, key, value) {
    prepare(ctx.db, 'INSERT INTO guild_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function deleteConfig(ctx, key) {
    prepare(ctx.db, 'DELETE FROM guild_config WHERE key = ?').run(key);
}
export function getAllConfig(ctx) {
    const rows = prepare(ctx.db, 'SELECT key, value FROM guild_config').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
//# sourceMappingURL=config.js.map