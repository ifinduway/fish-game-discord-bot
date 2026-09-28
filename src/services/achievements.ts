// Achievements (WP3): tiered thresholds on 'all'-scope stats; each tier is granted exactly once (achievements PK).
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { COSMETIC_BY_ID } from '../data/cosmetics.js';
import type { AchievementDef, Reward } from '../data/types.js';
import { prepare } from '../db/database.js';
import * as stats from '../db/repos/stats.js';
import { nextTier, reachedTiers } from '../game/achievements.js';
import { grantReward } from './rewards.js';

/** Reward of a tier incl. its title cosmetic (skipped with a warning when the id is unknown to the catalog). */
function tierReward(def: AchievementDef, tierIndex: number): Reward {
  const tier = def.tiers[tierIndex]!;
  if (!tier.title) return tier.reward;
  if (!COSMETIC_BY_ID[tier.title]) {
    console.warn(`[achievements] unknown title cosmetic '${tier.title}' in '${def.id}' — skipped`);
    return tier.reward;
  }
  return { ...tier.reward, cosmetics: [...(tier.reward.cosmetics ?? []), tier.title] };
}

/**
 * Grants every newly reached tier. `metrics` limits the check to achievements on those stats (all when omitted).
 * Idempotent: INSERT OR IGNORE on (user, achievement, tier) guards the grant.
 */
export function checkAchievements(ctx: GameContext, userId: string, metrics?: readonly string[]): Notice[] {
  const filter = metrics ? new Set(metrics) : null;
  const defs = ACHIEVEMENTS.filter((a) => !filter || filter.has(a.stat));
  if (defs.length === 0) return [];
  const notices: Notice[] = [];
  ctx.db.transaction(() => {
    const now = ctx.clock.now();
    for (const def of defs) {
      const value = stats.get(ctx, userId, def.stat, stats.SCOPE_ALL);
      for (const tier of reachedTiers(def, value)) {
        const r = prepare(ctx.db, 'INSERT OR IGNORE INTO achievements (user_id, achievement_id, tier, achieved_at) VALUES (?, ?, ?, ?)').run(
          userId,
          def.id,
          tier,
          now,
        );
        if (r.changes === 0) continue;
        const res = grantReward(ctx, userId, tierReward(def, tier - 1), `achievement:${def.id}:${tier}`);
        notices.push({ userId, text: `🏆 Достижение «${def.name}» — уровень ${tier}! Награда: ${res.summary}` }, ...res.notices);
      }
    }
  })();
  return notices;
}

export interface AchievementView {
  id: string;
  name: string;
  stat: string;
  value: number;
  /** highest granted tier (0 = none) */
  tier: number;
  maxTier: number;
  next: { tier: number; threshold: number } | null;
}

export function listAchievements(ctx: GameContext, userId: string): AchievementView[] {
  const rows = prepare(ctx.db, 'SELECT achievement_id AS id, MAX(tier) AS tier FROM achievements WHERE user_id = ? GROUP BY achievement_id').all(userId) as {
    id: string;
    tier: number;
  }[];
  const granted = new Map(rows.map((r) => [r.id, r.tier]));
  return ACHIEVEMENTS.map((def) => {
    const value = stats.get(ctx, userId, def.stat, stats.SCOPE_ALL);
    return { id: def.id, name: def.name, stat: def.stat, value, tier: granted.get(def.id) ?? 0, maxTier: def.tiers.length, next: nextTier(def, value) };
  });
}
