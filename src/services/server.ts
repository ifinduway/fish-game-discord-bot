// Server-wide state: active-player counts, weekly server goal, /server overview and personal /stats view.
//
// Decisions:
// - "Active players (last N days)" = distinct users with `casts` > 0 in any 'd:<dayKey>' stats scope of the last N local days.
// - Weekly goal is created lazily for the current week key (first fish of the week or first /server call):
//   metric BALANCE.serverGoal.metric ('total_weight'), target = baseTarget × max(1, activePlayers(7d) / referencePlayers),
//   rounded up to BALANCE.serverGoal.targetRounding. On completion every player with `casts` > 0 in 'w:<weekKey>'
//   (plus the finishing catcher) gets rewardPearls/rewardCoins exactly once (completed_at + rewarded guards).
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { EventOf, Notice } from '../core/events.js';
import { dayKey, weekKey as weekKeyOf } from '../core/time.js';
import { COSMETIC_BY_ID } from '../data/cosmetics.js';
import { FISH, FISH_BY_ID } from '../data/fish.js';
import { RARITIES, rarityIndex, type Rarity } from '../data/types.js';
import { prepare } from '../db/database.js';
import { listCosmetics } from '../db/repos/inventory.js';
import { getPlayer, type PlayerRow } from '../db/repos/players.js';
import { getAllServerStats } from '../db/repos/server-stats.js';
import { SCOPE_ALL, getAll, scopeDay, scopeWeek } from '../db/repos/stats.js';
import { BOSS_SLAYER_TITLE, BOSS_SLAYER_TITLE_NAME } from '../game/boss.js';
import { announcePayload } from './announce.js';
import { playerName } from './leaderboard.js';
import { getActiveServerEvents, type ServerEventRow } from './server-events.js';
import { grantReward } from './rewards.js';

// ───────────────────────── active players ─────────────────────────

/** Distinct players with casts in the last `days` local days (today included). */
export function countActivePlayers(ctx: GameContext, days: number = BALANCE.boss.activeWindowDays): number {
  const now = ctx.clock.now();
  const tz = ctx.config.timezone;
  const scopes = Array.from({ length: days }, (_, i) => scopeDay(dayKey(now - i * 86_400_000, tz)));
  const sql = `SELECT COUNT(DISTINCT user_id) AS n FROM stats WHERE metric = 'casts' AND value > 0 AND scope IN (${scopes.map(() => '?').join(',')})`;
  return (prepare(ctx.db, sql).get(...scopes) as { n: number }).n;
}

/** Players with casts > 0 in week `weekKey`. */
export function listWeeklyActivePlayers(ctx: GameContext, weekKey: string): string[] {
  return (
    prepare(ctx.db, "SELECT user_id FROM stats WHERE scope = ? AND metric = 'casts' AND value > 0 ORDER BY user_id").all(scopeWeek(weekKey)) as {
      user_id: string;
    }[]
  ).map((r) => r.user_id);
}

// ───────────────────────── weekly server goal ─────────────────────────

export interface ServerGoalRow {
  week_key: string;
  metric: string;
  target: number;
  progress: number;
  completed_at: number | null;
  rewarded: number;
}

export function computeGoalTarget(activePlayers: number): number {
  const g = BALANCE.serverGoal;
  const raw = g.baseTarget * Math.max(1, activePlayers / g.referencePlayers);
  return Math.ceil(raw / g.targetRounding) * g.targetRounding;
}

export function getServerGoal(ctx: GameContext, weekKey: string): ServerGoalRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM server_goals WHERE week_key = ?').get(weekKey) as ServerGoalRow | undefined;
}

/** Returns the goal of `weekKey` (default current week), creating it if missing. */
export function ensureServerGoal(ctx: GameContext, weekKey: string = weekKeyOf(ctx.clock.now(), ctx.config.timezone)): ServerGoalRow {
  const existing = getServerGoal(ctx, weekKey);
  if (existing) return existing;
  prepare(ctx.db, 'INSERT OR IGNORE INTO server_goals (week_key, metric, target) VALUES (?, ?, ?)').run(
    weekKey,
    BALANCE.serverGoal.metric,
    computeGoalTarget(countActivePlayers(ctx, 7)),
  );
  return getServerGoal(ctx, weekKey)!;
}

export interface GoalCompletion {
  goal: ServerGoalRow;
  rewardedUsers: string[];
}

/** Subscriber body (fish_caught): adds progress; on completion rewards weekly-active players once. */
export function addServerGoalProgress(ctx: GameContext, e: EventOf<'fish_caught'>): Notice[] {
  const done = ctx.db.transaction((): GoalCompletion | null => {
    const goal = ensureServerGoal(ctx);
    const delta = goal.metric === 'catches' ? 1 : goal.metric === 'total_weight' ? e.weight : 0;
    if (delta <= 0) return null;
    prepare(ctx.db, 'UPDATE server_goals SET progress = progress + ? WHERE week_key = ?').run(delta, goal.week_key);
    const completed = prepare(
      ctx.db,
      'UPDATE server_goals SET completed_at = ? WHERE week_key = ? AND completed_at IS NULL AND progress >= target',
    ).run(ctx.clock.now(), goal.week_key);
    if (completed.changes === 0) return null;
    return rewardServerGoal(ctx, goal.week_key, [e.userId]);
  })();
  if (!done) return [];
  void announceGoalComplete(ctx, done);
  return done.rewardedUsers.includes(e.userId)
    ? [{ userId: e.userId, text: `🎯 Цель сервера выполнена! Награда: 🐚 ${BALANCE.serverGoal.rewardPearls} · 🪙 ${BALANCE.serverGoal.rewardCoins}` }]
    : [];
}

/** Grants the goal reward to weekly-active players (+ `extraUsers`) exactly once. null if already rewarded / not completed. */
export function rewardServerGoal(ctx: GameContext, weekKey: string, extraUsers: string[] = []): GoalCompletion | null {
  return ctx.db.transaction((): GoalCompletion | null => {
    const claim = prepare(ctx.db, 'UPDATE server_goals SET rewarded = 1 WHERE week_key = ? AND rewarded = 0 AND completed_at IS NOT NULL').run(weekKey);
    if (claim.changes === 0) return null;
    const users = [...new Set([...listWeeklyActivePlayers(ctx, weekKey), ...extraUsers])].filter((u) => getPlayer(ctx, u));
    const g = BALANCE.serverGoal;
    for (const u of users) grantReward(ctx, u, { pearls: g.rewardPearls, coins: g.rewardCoins }, `server_goal:${weekKey}`);
    return { goal: getServerGoal(ctx, weekKey)!, rewardedUsers: users };
  })();
}

async function announceGoalComplete(ctx: GameContext, c: GoalCompletion): Promise<void> {
  const g = BALANCE.serverGoal;
  await announcePayload(ctx, {
    title: '🎯 Цель сервера выполнена!',
    description: `Вместе мы поймали **${Math.round(c.goal.target).toLocaleString('ru-RU')} кг** рыбы за неделю!\n${c.rewardedUsers.length} активных игроков получают 🐚 ${g.rewardPearls} · 🪙 ${g.rewardCoins}.`,
    color: 0x2ecc71,
  });
}

// ───────────────────────── /server overview ─────────────────────────

export interface SpeciesRecordView {
  speciesId: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  userId: string;
  username: string;
  weight: number;
}

export interface ServerOverview {
  totals: { catches: number; totalWeight: number; casts: number; bossesDefeated: number };
  week: { key: string; catches: number; totalWeight: number; activePlayers: number };
  players: number;
  records: SpeciesRecordView[];
  goal: ServerGoalRow;
  events: ServerEventRow[];
  /** highest-rarity species ever caught (tie → fewest catches), with its first catcher */
  rarest: { speciesId: string; name: string; emoji: string; rarity: Rarity; userId: string; username: string; caughtAt: number } | null;
}

export function getServerOverview(ctx: GameContext, recordsLimit = 10): ServerOverview {
  const wk = weekKeyOf(ctx.clock.now(), ctx.config.timezone);
  const all = getAllServerStats(ctx, SCOPE_ALL);
  const week = getAllServerStats(ctx, scopeWeek(wk));
  const records = (
    prepare(ctx.db, 'SELECT species_id, user_id, weight FROM species_records ORDER BY weight DESC, caught_at ASC LIMIT ?').all(recordsLimit) as {
      species_id: string;
      user_id: string;
      weight: number;
    }[]
  ).map((r) => {
    const f = FISH_BY_ID[r.species_id];
    return {
      speciesId: r.species_id,
      name: f?.name ?? r.species_id,
      emoji: f?.emoji ?? '🐟',
      rarity: f?.rarity ?? 'common',
      userId: r.user_id,
      username: playerName(ctx, r.user_id),
      weight: r.weight,
    };
  });

  const caught = prepare(ctx.db, 'SELECT species_id, SUM(count) AS total, MIN(first_caught_at) AS first FROM collection GROUP BY species_id').all() as {
    species_id: string;
    total: number;
    first: number;
  }[];
  let best: (typeof caught)[number] | null = null;
  for (const c of caught) {
    const f = FISH_BY_ID[c.species_id];
    if (!f) continue;
    if (!best) {
      best = c;
      continue;
    }
    const bf = FISH_BY_ID[best.species_id]!;
    const cmp = rarityIndex(f.rarity) - rarityIndex(bf.rarity) || best.total - c.total || best.first - c.first;
    if (cmp > 0) best = c;
  }
  let rarest: ServerOverview['rarest'] = null;
  if (best) {
    const f = FISH_BY_ID[best.species_id]!;
    const holder = prepare(ctx.db, 'SELECT user_id, first_caught_at FROM collection WHERE species_id = ? ORDER BY first_caught_at, user_id LIMIT 1').get(
      best.species_id,
    ) as { user_id: string; first_caught_at: number };
    rarest = {
      speciesId: f.id,
      name: f.name,
      emoji: f.emoji,
      rarity: f.rarity,
      userId: holder.user_id,
      username: playerName(ctx, holder.user_id),
      caughtAt: holder.first_caught_at,
    };
  }

  return {
    totals: { catches: all.catches ?? 0, totalWeight: all.total_weight ?? 0, casts: all.casts ?? 0, bossesDefeated: all.bosses_defeated ?? 0 },
    week: { key: wk, catches: week.catches ?? 0, totalWeight: week.total_weight ?? 0, activePlayers: listWeeklyActivePlayers(ctx, wk).length },
    players: (prepare(ctx.db, 'SELECT COUNT(*) AS n FROM players').get() as { n: number }).n,
    records,
    goal: ensureServerGoal(ctx, wk),
    events: getActiveServerEvents(ctx),
    rarest,
  };
}

// ───────────────────────── personal stats (/stats, /profile) ─────────────────────────

export interface PlayerStatsView {
  player: PlayerRow;
  /** stats counters, scope 'all' */
  stats: Record<string, number>;
  collection: { caught: number; total: number };
  /** personal best per species, heaviest first */
  personalRecords: { speciesId: string; name: string; emoji: string; rarity: Rarity; weight: number; count: number }[];
  byRarity: { rarity: Rarity; count: number }[];
  /** perfects / catches (0..1) */
  perfectRate: number;
  titles: string[];
  activeTitle: string | null;
}

export function getPlayerStatsView(ctx: GameContext, userId: string): PlayerStatsView | null {
  const player = getPlayer(ctx, userId);
  if (!player) return null;
  const stats = getAll(ctx, userId, SCOPE_ALL);
  const rows = prepare(ctx.db, 'SELECT species_id, count, best_weight FROM collection WHERE user_id = ? ORDER BY best_weight DESC').all(userId) as {
    species_id: string;
    count: number;
    best_weight: number;
  }[];
  const personalRecords = rows.map((r) => {
    const f = FISH_BY_ID[r.species_id];
    return {
      speciesId: r.species_id,
      name: f?.name ?? r.species_id,
      emoji: f?.emoji ?? '🐟',
      rarity: (f?.rarity ?? 'common') as Rarity,
      weight: r.best_weight,
      count: r.count,
    };
  });
  const catches = stats.catches ?? 0;
  const titles = listCosmetics(ctx, userId).flatMap((c) => {
    const def = COSMETIC_BY_ID[c.cosmetic_id];
    if (def) return def.type === 'title' ? [def.name] : [];
    return c.cosmetic_id === BOSS_SLAYER_TITLE ? [BOSS_SLAYER_TITLE_NAME] : [];
  });
  return {
    player,
    stats,
    collection: { caught: rows.length, total: FISH.length },
    personalRecords,
    byRarity: RARITIES.map((r) => ({ rarity: r, count: stats[`catch_${r}`] ?? 0 })),
    perfectRate: catches > 0 ? (stats.perfects ?? 0) / catches : 0,
    titles,
    activeTitle: player.active_title ? cosmeticName(player.active_title) : null,
  };
}

/** Display name of a cosmetic id (catalog name; raw slayer title fallback; else the id). */
export function cosmeticName(id: string): string {
  return COSMETIC_BY_ID[id]?.name ?? (id === BOSS_SLAYER_TITLE ? BOSS_SLAYER_TITLE_NAME : id);
}
