// Achievement tier logic (pure).
import type { AchievementDef } from '../data/types.js';

/** 1-based tier numbers whose threshold is reached by `value`. */
export function reachedTiers(def: AchievementDef, value: number): number[] {
  const out: number[] = [];
  def.tiers.forEach((t, i) => {
    if (value >= t.threshold) out.push(i + 1);
  });
  return out;
}

/** Next unreached tier (1-based) and its threshold, or null when all tiers are done. */
export function nextTier(def: AchievementDef, value: number): { tier: number; threshold: number } | null {
  const i = def.tiers.findIndex((t) => value < t.threshold);
  return i < 0 ? null : { tier: i + 1, threshold: def.tiers[i]!.threshold };
}
