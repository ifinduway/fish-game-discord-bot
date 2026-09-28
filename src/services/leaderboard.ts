// Leaderboard queries (8 categories) + weekly reset (top-1 of every weekly category of the PREVIOUS week gets pearls).
// Reads per-player `stats` counters written by WP3 (subscribers/stats.ts); never writes them.
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import { prevWeekKey, weekKey as weekKeyOf } from '../core/time.js';
import { FISH } from '../data/fish.js';
import { prepare, type DbCtx } from '../db/database.js';
import { markRun } from '../db/repos/periodic.js';
import { activeSeasonId, scopeSeason, scopeWeek } from '../db/repos/stats.js';
import {
  LEADERBOARD_BY_ID,
  WEEKLY_CATEGORIES,
  formatLeaderboardValue,
  placeLabel,
  type LeaderboardCategory,
  type LeaderboardCategoryDef,
} from '../game/leaderboard.js';
import { announcePayload } from './announce.js';
import { grantReward } from './rewards.js';

/** Display name of a player: stored username, else a short fallback. */
export function playerName(ctx: DbCtx, userId: string): string {
  const r = prepare(ctx.db, 'SELECT username FROM players WHERE user_id = ?').get(userId) as { username: string } | undefined;
  return r?.username || `Рыбак ${userId.slice(-4)}`;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  /** primary sort value (kg, coins, count, level…) */
  value: number;
  /** secondary sort value (xp for level/pass) */
  secondary: number;
  /** formatted value (Russian) */
  display: string;
}

export interface LeaderboardResult {
  category: LeaderboardCategory;
  def: LeaderboardCategoryDef;
  title: string;
  subtitle: string;
  rows: LeaderboardEntry[];
  /** requester's entry (may be outside the top), null if not ranked */
  me: LeaderboardEntry | null;
}

export interface LeaderboardOptions {
  userId?: string;
  /** week key for weekly categories (default: current week) */
  weekKey?: string;
  /** season id for season categories (default: active season) */
  seasonId?: number | null;
  limit?: number;
}

interface Source {
  /** SELECT user_id, v1, v2 FROM … (only ranked players) */
  sql: string;
  params: unknown[];
  subtitle: string;
}

function seasonName(ctx: DbCtx, seasonId: number): string {
  const r = prepare(ctx.db, 'SELECT name FROM seasons WHERE id = ?').get(seasonId) as { name: string } | undefined;
  return r?.name ?? `Сезон ${seasonId}`;
}

function sourceFor(ctx: GameContext, category: LeaderboardCategory, opts: LeaderboardOptions): Source | null {
  const def = LEADERBOARD_BY_ID[category];
  const statSql = 'SELECT user_id, value AS v1, 0 AS v2 FROM stats WHERE scope = ? AND metric = ? AND value > 0';
  if (def.weekly) {
    const wk = opts.weekKey ?? weekKeyOf(ctx.clock.now(), ctx.config.timezone);
    return { sql: statSql, params: [scopeWeek(wk), def.metric], subtitle: `Неделя ${wk}` };
  }
  switch (category) {
    case 'boss_damage_season':
    case 'pass_level': {
      const sid = opts.seasonId === undefined ? activeSeasonId(ctx) : opts.seasonId;
      if (sid === null) return null;
      const subtitle = seasonName(ctx, sid);
      if (category === 'boss_damage_season') return { sql: statSql, params: [scopeSeason(sid), def.metric], subtitle };
      return {
        sql: 'SELECT user_id, level AS v1, xp AS v2 FROM season_pass WHERE season_id = ? AND (level > 0 OR xp > 0)',
        params: [sid],
        subtitle,
      };
    }
    case 'collection':
      return { sql: 'SELECT user_id, COUNT(*) AS v1, 0 AS v2 FROM collection GROUP BY user_id', params: [], subtitle: `Всего видов: ${FISH.length}` };
    case 'level':
      return { sql: 'SELECT user_id, level AS v1, xp AS v2 FROM players', params: [], subtitle: 'За всё время' };
    default:
      return null;
  }
}

function display(category: LeaderboardCategory, v1: number, v2: number): string {
  if (category === 'collection') return formatLeaderboardValue(category, v1, FISH.length);
  if (category === 'level') return formatLeaderboardValue(category, v1, v2);
  return formatLeaderboardValue(category, v1);
}

/** Top N + requester rank. Ordering: v1 desc, v2 desc, user_id asc (deterministic). */
export function getLeaderboard(ctx: GameContext, category: LeaderboardCategory, opts: LeaderboardOptions = {}): LeaderboardResult {
  const def = LEADERBOARD_BY_ID[category];
  const limit = opts.limit ?? BALANCE.leaderboard.size;
  const src = sourceFor(ctx, category, opts);
  const title = `${def.emoji} ${def.title}`;
  if (!src) return { category, def, title, subtitle: 'Нет активного сезона', rows: [], me: null };

  const sql = `WITH b AS (${src.sql}),
    r AS (SELECT user_id, v1, v2, ROW_NUMBER() OVER (ORDER BY v1 DESC, v2 DESC, user_id ASC) AS rk FROM b)
    SELECT r.user_id AS userId, r.v1 AS v1, r.v2 AS v2, r.rk AS rk, p.username AS username
    FROM r LEFT JOIN players p ON p.user_id = r.user_id
    WHERE r.rk <= ? OR r.user_id = ? ORDER BY r.rk`;
  const raw = prepare(ctx.db, sql).all(...src.params, limit, opts.userId ?? null) as {
    userId: string;
    v1: number;
    v2: number;
    rk: number;
    username: string | null;
  }[];
  const entries: LeaderboardEntry[] = raw.map((r) => ({
    rank: r.rk,
    userId: r.userId,
    username: r.username || `Рыбак ${r.userId.slice(-4)}`,
    value: r.v1,
    secondary: r.v2,
    display: display(category, r.v1, r.v2),
  }));
  return {
    category,
    def,
    title,
    subtitle: src.subtitle,
    rows: entries.filter((e) => e.rank <= limit),
    me: opts.userId ? (entries.find((e) => e.userId === opts.userId) ?? null) : null,
  };
}

export interface WeeklyResetResult {
  weekKey: string;
  categories: { category: LeaderboardCategory; title: string; top: LeaderboardEntry[]; winner: LeaderboardEntry | null }[];
}

/**
 * Weekly results for `weekKey` (default: previous week). Idempotent via periodic_runs ('weekly', weekKey):
 * returns null when already done. Top-1 of each weekly category gets BALANCE.weekly.winnerPearls.
 */
export function runWeeklyReset(ctx: GameContext, weekKey: string = prevWeekKey(ctx.clock.now(), ctx.config.timezone)): WeeklyResetResult | null {
  const result = ctx.db.transaction((): WeeklyResetResult | null => {
    if (!markRun(ctx, 'weekly', weekKey)) return null;
    const out: WeeklyResetResult = { weekKey, categories: [] };
    for (const category of WEEKLY_CATEGORIES) {
      const board = getLeaderboard(ctx, category, { weekKey, limit: 3 });
      const winner = board.rows[0] ?? null;
      if (winner) grantReward(ctx, winner.userId, { pearls: BALANCE.weekly.winnerPearls }, `weekly_top:${category}:${weekKey}`);
      out.categories.push({ category, title: board.title, top: board.rows, winner });
    }
    return out;
  })();
  if (result) void announceWeeklyResults(ctx, result);
  return result;
}

async function announceWeeklyResults(ctx: GameContext, r: WeeklyResetResult): Promise<void> {
  if (r.categories.every((c) => c.top.length === 0)) return;
  await announcePayload(ctx, {
    title: `🏁 Итоги недели ${r.weekKey}`,
    description: `Победители недельных рейтингов получают 🐚 ${BALANCE.weekly.winnerPearls}! Новая неделя уже началась — удачной рыбалки!`,
    color: 0xf1c40f,
    fields: r.categories.map((c) => ({
      name: c.title,
      value: c.top.length ? c.top.map((e) => `${placeLabel(e.rank)} <@${e.userId}> — ${e.display}`).join('\n') : '—',
    })),
  });
}
