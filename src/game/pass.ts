// Season pass & season rotation (pure).
import { BALANCE } from '../config/balance.js';
import type { SeasonThemeId } from '../data/types.js';

/** Theme rotation by season number: 1 → winter, 2 → spring, 3 → summer, 4 → autumn, 5 → winter … */
export const SEASON_THEME_ORDER: SeasonThemeId[] = ['winter', 'spring', 'summer', 'autumn'];

export function themeForSeasonNumber(n: number): SeasonThemeId {
  const i = (((Math.floor(n) - 1) % SEASON_THEME_ORDER.length) + SEASON_THEME_ORDER.length) % SEASON_THEME_ORDER.length;
  return SEASON_THEME_ORDER[i]!;
}

export interface PassLevelInfo {
  level: number;
  /** xp inside the current level (0 at max level) */
  xpIntoLevel: number;
  /** xp needed for the next level (0 at max level) */
  xpToNext: number;
  maxLevel: number;
}

/** Pass level for total season xp (flat BALANCE.pass.xpPerLevel per level, capped at BALANCE.pass.levels). */
export function passLevelForXp(xp: number, xpPerLevel: number = BALANCE.pass.xpPerLevel, maxLevel: number = BALANCE.pass.levels): number {
  return Math.max(0, Math.min(maxLevel, Math.floor(Math.max(0, xp) / xpPerLevel)));
}

export function passLevelInfo(xp: number, xpPerLevel: number = BALANCE.pass.xpPerLevel, maxLevel: number = BALANCE.pass.levels): PassLevelInfo {
  const level = passLevelForXp(xp, xpPerLevel, maxLevel);
  if (level >= maxLevel) return { level, xpIntoLevel: 0, xpToNext: 0, maxLevel };
  return { level, xpIntoLevel: Math.max(0, xp) - level * xpPerLevel, xpToNext: xpPerLevel, maxLevel };
}
