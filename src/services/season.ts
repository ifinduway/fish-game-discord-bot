// Season lifecycle & season pass (WP3).
// Seasonal challenges / pass / 's:<id>' stats are keyed by season id, so a new season resets them naturally;
// nothing else (coins, pearls, gear, collection, cosmetics) is touched on rollover.
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { nextDayReset } from '../core/time.js';
import { PASS_REWARDS } from '../data/pass.js';
import { SEASON_THEME_BY_ID } from '../data/seasons.js';
import type { SeasonThemeId } from '../data/types.js';
import { prepare } from '../db/database.js';
import { addCosmetic } from '../db/repos/inventory.js';
import { getPlayer } from '../db/repos/players.js';
import * as stats from '../db/repos/stats.js';
import { passLevelInfo, themeForSeasonNumber } from '../game/pass.js';
import { renderSeasonSummaryCard } from '../render/index.js';
import { announceText } from './announce.js';
import { getOrCreatePlayer } from './player.js';
import { grantReward } from './rewards.js';

export interface Season {
  id: number;
  themeId: SeasonThemeId;
  name: string;
  startsAt: number;
  endsAt: number;
}

interface SeasonRow {
  id: number;
  theme_id: string;
  name: string;
  starts_at: number;
  ends_at: number;
  status: 'active' | 'ended';
}

const DAY_MS = 86_400_000;

function toSeason(r: SeasonRow): Season {
  return { id: r.id, themeId: r.theme_id as SeasonThemeId, name: r.name, startsAt: r.starts_at, endsAt: r.ends_at };
}

export function seasonName(n: number, themeId: SeasonThemeId): string {
  const theme = SEASON_THEME_BY_ID[themeId];
  return `Сезон ${n}: ${theme?.name ?? themeId}`;
}

export function getActiveSeason(ctx: GameContext): Season | null {
  const r = prepare(ctx.db, "SELECT * FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as SeasonRow | undefined;
  return r ? toSeason(r) : null;
}

export function getSeason(ctx: GameContext, id: number): (Season & { status: 'active' | 'ended' }) | null {
  const r = prepare(ctx.db, 'SELECT * FROM seasons WHERE id = ?').get(id) as SeasonRow | undefined;
  return r ? { ...toSeason(r), status: r.status } : null;
}

/**
 * Creates the next season (id = max + 1, theme by number, BALANCE.season.durationDays long, ending at local midnight).
 * Callers must make sure no season is active.
 */
export function startNewSeason(ctx: GameContext): Season {
  const now = ctx.clock.now();
  const last = prepare(ctx.db, 'SELECT MAX(id) AS id FROM seasons').get() as { id: number | null };
  const id = (last.id ?? 0) + 1;
  const themeId = themeForSeasonNumber(id);
  const endsAt = nextDayReset(now + (BALANCE.season.durationDays - 1) * DAY_MS, ctx.config.timezone);
  const name = seasonName(id, themeId);
  prepare(ctx.db, "INSERT INTO seasons (id, theme_id, name, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, 'active')").run(
    id,
    themeId,
    name,
    now,
    endsAt,
  );
  return { id, themeId, name, startsAt: now, endsAt };
}

/** Returns the active season, creating the next one (season 1 on first run) when none is active. */
export function ensureActiveSeason(ctx: GameContext): Season {
  const active = getActiveSeason(ctx);
  if (active) return active;
  return ctx.db.transaction(() => getActiveSeason(ctx) ?? startNewSeason(ctx))();
}

// ---------- Pass ----------

export interface PassProgress {
  seasonId: number;
  level: number;
  /** total season xp */
  xp: number;
  xpIntoLevel: number;
  xpToNext: number;
  maxLevel: number;
}

export function getPassProgress(ctx: GameContext, userId: string, seasonId?: number): PassProgress | null {
  const sid = seasonId ?? getActiveSeason(ctx)?.id;
  if (sid === undefined) return null;
  const r = prepare(ctx.db, 'SELECT xp FROM season_pass WHERE user_id = ? AND season_id = ?').get(userId, sid) as { xp: number } | undefined;
  const xp = r?.xp ?? 0;
  const info = passLevelInfo(xp);
  return { seasonId: sid, xp, ...info };
}

/**
 * Adds season-pass XP for the active season (creating it if needed). Each new level auto-grants its PASS_REWARDS
 * entry and emits `pass_level_up`. Also records the `pass_xp` stat ('all' + 's:<id>'). Safe inside a transaction.
 */
export function addPassXp(ctx: GameContext, userId: string, amount: number): Notice[] {
  const xpGain = Math.floor(amount);
  if (xpGain <= 0) return [];
  const notices: Notice[] = [];
  const levelsGained: number[] = [];
  let seasonId = 0;
  ctx.db.transaction(() => {
    const season = ensureActiveSeason(ctx);
    seasonId = season.id;
    prepare(ctx.db, 'INSERT INTO season_pass (user_id, season_id, xp, level) VALUES (?, ?, 0, 0) ON CONFLICT(user_id, season_id) DO NOTHING').run(
      userId,
      season.id,
    );
    prepare(ctx.db, 'UPDATE season_pass SET xp = xp + ? WHERE user_id = ? AND season_id = ?').run(xpGain, userId, season.id);
    stats.inc(ctx, userId, 'pass_xp', xpGain, [stats.SCOPE_ALL, stats.scopeSeason(season.id)]);
    const row = prepare(ctx.db, 'SELECT xp, level FROM season_pass WHERE user_id = ? AND season_id = ?').get(userId, season.id) as {
      xp: number;
      level: number;
    };
    const newLevel = passLevelInfo(row.xp).level;
    if (newLevel <= row.level) return;
    // store the level first so a nested addPassXp (reward containing passXp) cannot re-grant the same levels
    prepare(ctx.db, 'UPDATE season_pass SET level = ? WHERE user_id = ? AND season_id = ?').run(newLevel, userId, season.id);
    for (let level = row.level + 1; level <= newLevel; level++) {
      levelsGained.push(level);
      const entry = PASS_REWARDS.find((p) => p.level === level);
      if (entry) {
        const res = grantReward(ctx, userId, entry.reward, `pass:${season.id}:${level}`);
        notices.push({ userId, text: `🎫 Уровень пасса **${level}**! Награда: ${res.summary}` }, ...res.notices);
      } else {
        notices.push({ userId, text: `🎫 Уровень пасса **${level}**!` });
      }
    }
  })();
  for (const level of levelsGained) notices.push(...ctx.bus.emit({ type: 'pass_level_up', userId, seasonId, level }, ctx));
  return notices;
}

// ---------- Season leaderboards & rollover ----------

export type SeasonCategoryId = 'pass_xp' | 'boss_damage' | 'total_weight';

export const SEASON_CATEGORIES: { id: SeasonCategoryId; title: string }[] = [
  { id: 'pass_xp', title: '🎫 Опыт пасса' },
  { id: 'boss_damage', title: '⚔️ Урон по боссам' },
  { id: 'total_weight', title: '⚖️ Вес улова' },
];

const numFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatCategoryValue(id: SeasonCategoryId, value: number): string {
  if (id === 'pass_xp') return `${numFmt.format(Math.floor(value))} XP`;
  if (id === 'boss_damage') return numFmt.format(Math.floor(value));
  return `${numFmt.format(value)} кг`;
}

export interface SeasonWinner {
  userId: string;
  username: string;
  value: number;
}

export interface SeasonCategoryResult {
  id: SeasonCategoryId;
  title: string;
  winners: SeasonWinner[];
}

function displayName(ctx: GameContext, userId: string): string {
  return getPlayer(ctx, userId)?.username || `Игрок ${userId.slice(-4)}`;
}

/** Top players of a season per category (highest first, ties by user id). */
export function getSeasonLeaders(ctx: GameContext, seasonId: number, limit: number = BALANCE.season.topPlaces): SeasonCategoryResult[] {
  return SEASON_CATEGORIES.map(({ id, title }) => {
    const rows =
      id === 'pass_xp'
        ? (prepare(ctx.db, 'SELECT user_id AS userId, xp AS value FROM season_pass WHERE season_id = ? AND xp > 0 ORDER BY xp DESC, user_id ASC LIMIT ?').all(
            seasonId,
            limit,
          ) as stats.TopRow[])
        : stats.top(ctx, id, stats.scopeSeason(seasonId), limit);
    return { id, title, winners: rows.map((r) => ({ userId: r.userId, username: displayName(ctx, r.userId), value: r.value })) };
  });
}

/** Value and 1-based rank of a user in a season category (rank null when no positive value). */
export function getSeasonStanding(ctx: GameContext, userId: string, seasonId: number, id: SeasonCategoryId): { value: number; rank: number | null } {
  if (id === 'pass_xp') {
    const xp = getPassProgress(ctx, userId, seasonId)?.xp ?? 0;
    if (xp <= 0) return { value: 0, rank: null };
    const r = prepare(
      ctx.db,
      'SELECT COUNT(*) AS n FROM season_pass WHERE season_id = ? AND (xp > ? OR (xp = ? AND user_id < ?))',
    ).get(seasonId, xp, xp, userId) as { n: number };
    return { value: xp, rank: r.n + 1 };
  }
  const scope = stats.scopeSeason(seasonId);
  return { value: stats.get(ctx, userId, id, scope), rank: stats.rank(ctx, userId, id, scope) };
}

export const seasonTitleId = (seasonId: number): string => `season-${seasonId}-top`;
export const seasonBadgeId = (themeId: SeasonThemeId): string => `badge-season-${themeId}`;

export interface SeasonSummary {
  season: Season;
  next: Season;
  categories: SeasonCategoryResult[];
}

/**
 * Ends the season (idempotent: returns null if it is not active) in ONE transaction: marks it ended,
 * grants the top-N of every season category the permanent title `season-<n>-top` + theme badge
 * `badge-season-<theme>`, then starts the next season.
 */
export function finalizeSeason(ctx: GameContext, seasonId: number): SeasonSummary | null {
  return ctx.db.transaction((): SeasonSummary | null => {
    const now = ctx.clock.now();
    const res = prepare(ctx.db, "UPDATE seasons SET status = 'ended', ends_at = MIN(ends_at, ?) WHERE id = ? AND status = 'active'").run(now, seasonId);
    if (res.changes === 0) return null;
    const season = getSeason(ctx, seasonId)!;
    const categories = getSeasonLeaders(ctx, seasonId);
    const winners = new Set(categories.flatMap((c) => c.winners.map((w) => w.userId)));
    // Direct cosmetic rows (not grantReward): season titles are synthesized ids that may be absent from COSMETIC_BY_ID.
    for (const userId of winners) {
      getOrCreatePlayer(ctx, userId);
      addCosmetic(ctx, userId, seasonTitleId(seasonId), now, `season:${seasonId}`);
      addCosmetic(ctx, userId, seasonBadgeId(season.themeId), now, `season:${seasonId}`);
    }
    // another active season can only exist if created concurrently; never create a second one
    const next = getActiveSeason(ctx) ?? startNewSeason(ctx);
    return { season, next, categories };
  })();
}

/** Scheduler entry: ensures a season exists and finalizes it once its end time has passed. */
export function rolloverIfDue(ctx: GameContext): SeasonSummary | null {
  const season = ensureActiveSeason(ctx);
  if (ctx.clock.now() < season.endsAt) return null;
  return finalizeSeason(ctx, season.id);
}

/** Posts the season summary (text + PNG card) to the announce channel. Never throws. */
export async function announceSeasonSummary(ctx: GameContext, summary: SeasonSummary): Promise<void> {
  const theme = SEASON_THEME_BY_ID[summary.season.themeId];
  const nextTheme = SEASON_THEME_BY_ID[summary.next.themeId];
  const categories = summary.categories.map((c) => ({
    title: c.title,
    winners: c.winners.map((w) => ({ username: w.username, value: formatCategoryValue(c.id, w.value) })),
  }));
  let file: { name: string; data: Buffer } | undefined;
  try {
    const data = await renderSeasonSummaryCard({
      seasonName: summary.season.name,
      emoji: theme?.emoji,
      colors: theme?.colors ?? ['#1e3c72', '#2a5298'],
      categories,
    });
    file = { name: 'season.png', data };
  } catch (err) {
    console.error('[season] summary card render failed:', err);
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = summary.categories.map((c) => {
    const w = c.winners.map((x, i) => `${medals[i] ?? `${i + 1}.`} <@${x.userId}> — ${formatCategoryValue(c.id, x.value)}`).join('\n');
    return `**${c.title}**\n${w || '— никого —'}`;
  });
  const text = [
    ...lines,
    `Победители получают постоянный титул и значок сезона.`,
    `Начался **${summary.next.name}** ${nextTheme?.emoji ?? ''}`.trim(),
  ].join('\n\n');
  await announceText(ctx, `${theme?.emoji ?? '🏁'} ${summary.season.name} завершён!`, text, undefined, file);
}
