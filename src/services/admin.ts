// Admin service logic (WP7): testable without Discord. The discord layer (commands/admin.ts) only parses
// options/permissions and calls these functions, catching AdminError / BossError / ServerEventError /
// InsufficientFundsError for a Russian ephemeral reply. Every mutating action writes an audit_log row.
import { isValidTimezone } from '../core/time.js';
import type { GameContext } from '../core/context.js';
import { COSMETIC_BY_ID } from '../data/cosmetics.js';
import { CONSUMABLE_BY_ID } from '../data/consumables.js';
import { GEAR_BY_ID } from '../data/gear.js';
import type { Reward } from '../data/types.js';
import { addAudit } from '../db/repos/audit.js';
import { CONFIG_KEYS, getAllConfig, setConfig } from '../db/repos/config.js';
import { prepare } from '../db/database.js';
import { getBalance, spendCoins, spendPearls, type Currency } from '../db/repos/wallet.js';
import { endBoss, spawnBoss, type BossRow } from './boss.js';
import { getOrCreatePlayer } from './player.js';
import { grantReward, type GrantResult } from './rewards.js';
import { announceSeasonSummary, finalizeSeason, getActiveSeason, startNewSeason, type Season, type SeasonSummary } from './season.js';
import { startServerEvent, type ServerEventRow } from './server-events.js';
import type { ServerEventType } from '../game/server-events.js';

/** User-facing error (Russian message) for the /admin command layer. */
export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminError';
  }
}

// ───────────────────────── config ─────────────────────────

export function setAnnounceChannel(ctx: GameContext, actorId: string, channelId: string): void {
  setConfig(ctx, CONFIG_KEYS.announceChannelId, channelId);
  addAudit(ctx, actorId, 'admin:config:channel', { channelId });
}

export function setTimezone(ctx: GameContext, actorId: string, tz: string): void {
  if (!isValidTimezone(tz)) throw new AdminError(`Некорректный часовой пояс: ${tz}. Используй IANA-формат, например Europe/Moscow.`);
  setConfig(ctx, CONFIG_KEYS.timezone, tz);
  addAudit(ctx, actorId, 'admin:config:timezone', { tz });
}

export function getConfigSummary(ctx: GameContext): { announceChannelId: string | null; timezone: string } {
  const cfg = getAllConfig(ctx);
  return { announceChannelId: cfg[CONFIG_KEYS.announceChannelId] ?? null, timezone: ctx.config.timezone };
}

// ───────────────────────── boss ─────────────────────────

export function adminSpawnBoss(ctx: GameContext, actorId: string, bossDefId?: string): BossRow {
  const row = spawnBoss(ctx, { bossDefId });
  addAudit(ctx, actorId, 'admin:boss:spawn', { bossId: row.id, bossDefId: row.boss_def_id });
  return row;
}

export function adminEndBoss(ctx: GameContext, actorId: string): void {
  endBoss(ctx);
  addAudit(ctx, actorId, 'admin:boss:end', {});
}

// ───────────────────────── server events ─────────────────────────

export function adminStartEvent(ctx: GameContext, actorId: string, type: ServerEventType, durationMinutes?: number): ServerEventRow {
  const row = startServerEvent(ctx, type, { durationMinutes });
  addAudit(ctx, actorId, 'admin:event:start', { type, durationMinutes, eventId: row.id });
  return row;
}

// ───────────────────────── season ─────────────────────────

export function adminStartSeason(ctx: GameContext, actorId: string): Season {
  if (getActiveSeason(ctx)) throw new AdminError('Сезон уже активен. Сначала заверши его: `/admin season end`.');
  const season = startNewSeason(ctx);
  addAudit(ctx, actorId, 'admin:season:start', { seasonId: season.id, name: season.name });
  return season;
}

export function adminEndSeason(ctx: GameContext, actorId: string): SeasonSummary {
  const active = getActiveSeason(ctx);
  if (!active) throw new AdminError('Сейчас нет активного сезона.');
  const summary = finalizeSeason(ctx, active.id);
  if (!summary) throw new AdminError('Не удалось завершить сезон (уже завершён?).');
  addAudit(ctx, actorId, 'admin:season:end', { seasonId: summary.season.id, nextSeasonId: summary.next.id });
  void announceSeasonSummary(ctx, summary);
  return summary;
}

// ───────────────────────── give / take ─────────────────────────

export type GiveKind = 'coins' | 'pearls' | 'item' | 'gear' | 'cosmetic';

const CURRENCY_QTY_RANGE = { min: 1, max: 1_000_000 } as const;
const ITEM_QTY_RANGE = { min: 1, max: 100 } as const;

/** Grants a reward to a player via services/rewards.grantReward (source 'admin'). Validates qty per kind. */
export function giveReward(ctx: GameContext, actorId: string, targetId: string, kind: GiveKind, id: string | undefined, qty: number): GrantResult {
  if (!Number.isInteger(qty)) throw new AdminError('Количество должно быть целым числом.');
  const isCurrency = kind === 'coins' || kind === 'pearls';
  const range = isCurrency ? CURRENCY_QTY_RANGE : ITEM_QTY_RANGE;
  if (qty < range.min || qty > range.max) throw new AdminError(`Количество: от ${range.min} до ${range.max}.`);

  const reward: Reward = {};
  if (kind === 'coins') {
    reward.coins = qty;
  } else if (kind === 'pearls') {
    reward.pearls = qty;
  } else if (kind === 'item') {
    if (!id || !CONSUMABLE_BY_ID[id]) throw new AdminError(`Неизвестный предмет: ${id ?? '(не указан)'}.`);
    reward.items = [{ itemId: id, qty }];
  } else if (kind === 'gear') {
    if (!id || !GEAR_BY_ID[id]) throw new AdminError(`Неизвестное снаряжение: ${id ?? '(не указано)'}.`);
    reward.gear = Array.from({ length: qty }, () => id);
  } else if (kind === 'cosmetic') {
    if (!id || !COSMETIC_BY_ID[id]) throw new AdminError(`Неизвестная косметика: ${id ?? '(не указана)'}.`);
    reward.cosmetics = Array.from({ length: qty }, () => id);
  } else {
    throw new AdminError(`Неизвестный тип награды: ${kind as string}.`);
  }

  const result = grantReward(ctx, targetId, reward, 'admin');
  addAudit(ctx, actorId, 'admin:give', { targetId, kind, id: id ?? null, qty, summary: result.summary });
  return result;
}

/** Removes currency from a player, clamped to their balance. Returns the amount actually taken and new balance. */
export function takeCurrency(ctx: GameContext, actorId: string, targetId: string, currency: Currency, qty: number): { taken: number; balance: number } {
  if (!Number.isInteger(qty) || qty < 1) throw new AdminError('Количество должно быть положительным целым числом.');
  getOrCreatePlayer(ctx, targetId);
  const balance = getBalance(ctx, targetId)[currency];
  const taken = Math.min(qty, balance);
  const newBalance = taken > 0 ? (currency === 'coins' ? spendCoins(ctx, targetId, taken) : spendPearls(ctx, targetId, taken)) : balance;
  addAudit(ctx, actorId, 'admin:take', { targetId, currency, requested: qty, taken, newBalance });
  return { taken, balance: newBalance };
}

// ───────────────────────── reset-user ─────────────────────────

/**
 * Every per-user table (from src/db/migrations.ts), ordered so FK-referencing rows are deleted before the
 * rows they reference (equipped → gear_items/caught_fish → players last). Global tables (guild_config, seasons,
 * bosses, server_goals, server_events, periodic_runs, audit_log, server_stats) are untouched.
 */
const PER_USER_TABLES_FK_ORDER = [
  'equipped',
  'caught_fish',
  'gear_items',
  'consumables',
  'active_bait',
  'cosmetics',
  'collection',
  'stats',
  'challenges',
  'challenge_bonuses',
  'achievements',
  'season_pass',
  'boss_contributions',
  'tournament_entries',
  'blackjack_hands',
  'species_records',
  'players',
] as const;

/** Deletes every row belonging to targetId across all per-user tables, in one transaction. */
export function resetUser(ctx: GameContext, actorId: string, targetId: string): void {
  ctx.db.transaction(() => {
    for (const table of PER_USER_TABLES_FK_ORDER) {
      prepare(ctx.db, `DELETE FROM ${table} WHERE user_id = ?`).run(targetId);
    }
    // per-user idempotency keys in the otherwise global periodic_runs ledger (subscribers/pass.ts, subscribers/stats.ts)
    prepare(ctx.db, 'DELETE FROM periodic_runs WHERE job IN (?, ?)').run(`pass_boss:${targetId}`, `boss_join:${targetId}`);
    addAudit(ctx, actorId, 'admin:reset-user', { targetId });
  })();
}
