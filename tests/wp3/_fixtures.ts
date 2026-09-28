// WP3 test fixtures: tiny challenge templates registered only in CHALLENGE_BY_ID (never in the generation pool),
// so tests do not depend on WP1's catalog ids.
import { CHALLENGE_BY_ID } from '../../src/data/challenges.js';
import type { ChallengeMetric, ChallengeScope, ChallengeTemplate, Reward } from '../../src/data/types.js';
import type { GameContext } from '../../src/core/context.js';
import { currentPeriods } from '../../src/services/challenges.js';
import pass from '../../src/subscribers/pass.js';
import stats from '../../src/subscribers/stats.js';
import challenges from '../../src/subscribers/challenges.js';
import achievements from '../../src/subscribers/achievements.js';

const registered: string[] = [];

export function fixtureTemplate(id: string, scope: ChallengeScope, metric: ChallengeMetric, reward: Reward, extra: Partial<ChallengeTemplate> = {}): ChallengeTemplate {
  const t: ChallengeTemplate = { id, scope, metric, target: [1, 1], title: `T ${id} {n} {param}`, reward, passXp: 0, ...extra };
  CHALLENGE_BY_ID[id] = t;
  registered.push(id);
  return t;
}

export function clearFixtureTemplates(): void {
  for (const id of registered.splice(0)) delete CHALLENGE_BY_ID[id];
}

/** Inserts a challenge row for the current period of `scope`. */
export function insertChallenge(ctx: GameContext, userId: string, t: ChallengeTemplate, target: number, param: string | null = t.param ?? null): number {
  const period = currentPeriods(ctx)[t.scope];
  const r = ctx.db
    .prepare('INSERT INTO challenges (user_id, scope, period_key, template_id, param, target, progress) VALUES (?, ?, ?, ?, ?, ?, 0)')
    .run(userId, t.scope, period, t.id, param, target);
  return Number(r.lastInsertRowid);
}

export function challengeRow(ctx: GameContext, id: number): { progress: number; target: number; completed_at: number | null } {
  return ctx.db.prepare('SELECT progress, target, completed_at FROM challenges WHERE id = ?').get(id) as {
    progress: number;
    target: number;
    completed_at: number | null;
  };
}

/** Registers all WP3 subscribers in loader order (alphabetical). */
export function registerWp3(ctx: GameContext): void {
  achievements(ctx.bus);
  challenges(ctx.bus);
  pass(ctx.bus);
  stats(ctx.bus);
}
