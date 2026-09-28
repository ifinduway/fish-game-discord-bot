import { prepare, type DbCtx } from '../database.js';

/** Known guild_config keys. Other WPs may use additional keys (document them). */
export const CONFIG_KEYS = {
  announceChannelId: 'announce_channel_id',
  timezone: 'timezone',
} as const;

export function getConfig(ctx: DbCtx, key: string): string | null {
  const row = prepare(ctx.db, 'SELECT value FROM guild_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setConfig(ctx: DbCtx, key: string, value: string): void {
  prepare(ctx.db, 'INSERT INTO guild_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function deleteConfig(ctx: DbCtx, key: string): void {
  prepare(ctx.db, 'DELETE FROM guild_config WHERE key = ?').run(key);
}

export function getAllConfig(ctx: DbCtx): Record<string, string> {
  const rows = prepare(ctx.db, 'SELECT key, value FROM guild_config').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
