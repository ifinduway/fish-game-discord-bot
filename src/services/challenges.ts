// Challenges (WP3): lazy generation per period, progress from events, reward granted exactly once.
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { dayKey, weekKey } from '../core/time.js';
import { CHALLENGE_BY_ID, CHALLENGE_TEMPLATES } from '../data/challenges.js';
import type { ChallengeMetric, ChallengeScope, ChallengeTemplate, LocationId, Reward } from '../data/types.js';
import { prepare } from '../db/database.js';
import { formatChallengeTitle, matchesParam, pickTemplates, rollTarget, type ProgressMeta } from '../game/challenges.js';
import { addPassXp, ensureActiveSeason } from './season.js';
import { getOrCreatePlayer } from './player.js';
import { grantReward } from './rewards.js';

export const CHALLENGE_SCOPES: ChallengeScope[] = ['daily', 'weekly', 'seasonal'];

export interface ChallengeRow {
  id: number;
  user_id: string;
  scope: ChallengeScope;
  period_key: string;
  template_id: string;
  param: string | null;
  target: number;
  progress: number;
  completed_at: number | null;
}

export interface ChallengeView {
  id: number;
  scope: ChallengeScope;
  periodKey: string;
  templateId: string;
  metric: ChallengeMetric | null;
  title: string;
  param: string | null;
  target: number;
  progress: number;
  completed: boolean;
  completedAt: number | null;
  reward: Reward;
  passXp: number;
}

export type ChallengePeriods = Record<ChallengeScope, string>;

/** Current period keys: daily 'YYYY-MM-DD', weekly 'YYYY-Www', seasonal = active season id. */
export function currentPeriods(ctx: GameContext): ChallengePeriods {
  const now = ctx.clock.now();
  const tz = ctx.config.timezone;
  return { daily: dayKey(now, tz), weekly: weekKey(now, tz), seasonal: String(ensureActiveSeason(ctx).id) };
}

/** Pass XP for completing a template: the template's own value, else BALANCE.passXp by scope. */
export function challengePassXp(t: ChallengeTemplate): number {
  if (t.passXp > 0) return t.passXp;
  const px = BALANCE.passXp;
  return t.scope === 'daily' ? px.dailyChallenge : t.scope === 'weekly' ? px.weeklyChallenge : px.seasonalChallenge;
}

function countFor(ctx: GameContext, scope: ChallengeScope): number {
  const c = BALANCE.challenges;
  if (scope === 'daily') return c.dailyCount;
  if (scope === 'weekly') return c.weeklyCount;
  return ctx.rng.int(c.seasonalMin, c.seasonalMax);
}

/** Templates the player can realistically do (location challenges only for unlocked locations). */
function poolFor(scope: ChallengeScope, level: number): ChallengeTemplate[] {
  return CHALLENGE_TEMPLATES.filter((t) => {
    if (t.scope !== scope) return false;
    if (t.metric === 'cast_at_location' && t.param) {
      const unlock = BALANCE.locationUnlockLevels[t.param as LocationId];
      if (unlock !== undefined && unlock > level) return false;
    }
    return true;
  });
}

/**
 * Generates the current daily (3), weekly (4) and seasonal (10–15) challenges if the player has none for the period.
 * Idempotent. Returns the number of rows created.
 */
export function ensureChallenges(ctx: GameContext, userId: string): number {
  return ctx.db.transaction((): number => {
    const periods = currentPeriods(ctx);
    let created = 0;
    let level: number | null = null;
    for (const scope of CHALLENGE_SCOPES) {
      const period = periods[scope];
      const existing = prepare(ctx.db, 'SELECT COUNT(*) AS n FROM challenges WHERE user_id = ? AND scope = ? AND period_key = ?').get(userId, scope, period) as {
        n: number;
      };
      if (existing.n > 0) continue;
      level ??= getOrCreatePlayer(ctx, userId).level;
      for (const t of pickTemplates(ctx.rng, poolFor(scope, level), countFor(ctx, scope))) {
        const r = prepare(
          ctx.db,
          'INSERT OR IGNORE INTO challenges (user_id, scope, period_key, template_id, param, target, progress) VALUES (?, ?, ?, ?, ?, ?, 0)',
        ).run(userId, scope, period, t.id, t.param ?? null, rollTarget(ctx.rng, t));
        created += r.changes;
      }
    }
    return created;
  })();
}

function toView(r: ChallengeRow): ChallengeView {
  const t = CHALLENGE_BY_ID[r.template_id];
  return {
    id: r.id,
    scope: r.scope,
    periodKey: r.period_key,
    templateId: r.template_id,
    metric: t?.metric ?? null,
    title: t ? formatChallengeTitle(t.title, r.target, r.param) : r.template_id,
    param: r.param,
    target: r.target,
    progress: r.progress,
    completed: r.completed_at !== null,
    completedAt: r.completed_at,
    reward: t?.reward ?? {},
    passXp: t ? challengePassXp(t) : 0,
  };
}

function currentRows(ctx: GameContext, userId: string, periods: ChallengePeriods, onlyOpen: boolean): ChallengeRow[] {
  return prepare(
    ctx.db,
    `SELECT * FROM challenges WHERE user_id = ? AND ${onlyOpen ? 'completed_at IS NULL AND ' : ''}
     ((scope = 'daily' AND period_key = ?) OR (scope = 'weekly' AND period_key = ?) OR (scope = 'seasonal' AND period_key = ?))
     ORDER BY CASE scope WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END, id`,
  ).all(userId, periods.daily, periods.weekly, periods.seasonal) as ChallengeRow[];
}

/** Current challenges of the player (generating them if needed), ordered daily → weekly → seasonal. */
export function listChallenges(ctx: GameContext, userId: string): ChallengeView[] {
  ensureChallenges(ctx, userId);
  return currentRows(ctx, userId, currentPeriods(ctx), false).map(toView);
}

/** Whether the "all dailies done" bonus was granted for the current day. */
export function dailyBonusClaimed(ctx: GameContext, userId: string): boolean {
  const day = currentPeriods(ctx).daily;
  return prepare(ctx.db, "SELECT 1 FROM challenge_bonuses WHERE user_id = ? AND scope = 'daily' AND period_key = ?").get(userId, day) !== undefined;
}

/**
 * Adds progress to every open current challenge on `metric` whose param matches `meta`. A challenge that reaches its
 * target is completed once (guarded `completed_at IS NULL` update), its reward + pass XP are granted and
 * `challenge_completed` is emitted. When all dailies of the day are done, +BALANCE.challenges.allDailyBonusPearls once.
 */
export function applyProgress(ctx: GameContext, userId: string, metric: ChallengeMetric, amount: number, meta: ProgressMeta = {}): Notice[] {
  if (!(amount > 0)) return [];
  const notices: Notice[] = [];
  const completed: { scope: ChallengeScope; templateId: string }[] = [];
  ctx.db.transaction(() => {
    const periods = currentPeriods(ctx);
    const now = ctx.clock.now();
    let dailyDone = false;
    for (const row of currentRows(ctx, userId, periods, true)) {
      const t = CHALLENGE_BY_ID[row.template_id];
      if (!t || t.metric !== metric || !matchesParam(metric, row.param, meta)) continue;
      prepare(ctx.db, 'UPDATE challenges SET progress = MIN(target, progress + ?) WHERE id = ? AND completed_at IS NULL').run(amount, row.id);
      const cur = prepare(ctx.db, 'SELECT progress, target FROM challenges WHERE id = ?').get(row.id) as { progress: number; target: number };
      if (cur.progress < cur.target) continue;
      const done = prepare(ctx.db, 'UPDATE challenges SET completed_at = ? WHERE id = ? AND completed_at IS NULL').run(now, row.id);
      if (done.changes !== 1) continue;
      const res = grantReward(ctx, userId, t.reward, `challenge:${row.scope}:${t.id}`);
      const passXp = challengePassXp(t);
      const title = formatChallengeTitle(t.title, row.target, row.param);
      notices.push({ userId, text: `✅ Испытание выполнено: **${title}** — ${res.summary}${passXp > 0 ? ` · 🎫 ${passXp} XP пасса` : ''}` });
      notices.push(...res.notices, ...addPassXp(ctx, userId, passXp));
      completed.push({ scope: row.scope, templateId: t.id });
      if (row.scope === 'daily') dailyDone = true;
    }
    if (dailyDone) notices.push(...grantDailyBonusIfAllDone(ctx, userId, periods.daily));
  })();
  for (const c of completed) notices.push(...ctx.bus.emit({ type: 'challenge_completed', userId, scope: c.scope, templateId: c.templateId }, ctx));
  return notices;
}

function grantDailyBonusIfAllDone(ctx: GameContext, userId: string, day: string): Notice[] {
  const r = prepare(
    ctx.db,
    "SELECT COUNT(*) AS total, COALESCE(SUM(completed_at IS NOT NULL), 0) AS done FROM challenges WHERE user_id = ? AND scope = 'daily' AND period_key = ?",
  ).get(userId, day) as { total: number; done: number };
  if (r.total === 0 || r.done < r.total) return [];
  const ins = prepare(ctx.db, "INSERT OR IGNORE INTO challenge_bonuses (user_id, scope, period_key) VALUES (?, 'daily', ?)").run(userId, day);
  if (ins.changes === 0) return [];
  const res = grantReward(ctx, userId, { pearls: BALANCE.challenges.allDailyBonusPearls }, 'challenge:daily_bonus');
  return [{ userId, text: `🌟 Все ежедневные испытания выполнены! Бонус: ${res.summary}` }, ...res.notices];
}
