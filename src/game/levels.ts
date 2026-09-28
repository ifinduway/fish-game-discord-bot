// Player XP curve (pure). players.xp stores progress INSIDE the current level.
import { BALANCE } from '../config/balance.js';

/** XP needed to go from `level` to `level + 1`. Infinity at the level cap. */
export function xpToNext(level: number): number {
  if (level >= BALANCE.levels.cap) return Infinity;
  return Math.round(BALANCE.levels.base * Math.pow(Math.max(1, level), BALANCE.levels.exponent));
}

/** Total XP accumulated from level 1 / 0 xp to reach (level, xp). */
export function totalXp(level: number, xp: number): number {
  let sum = xp;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

export interface XpResult {
  level: number;
  xp: number;
  /** each new level reached, ascending */
  levelsGained: number[];
}

/** Applies gained XP. At the cap, extra XP is kept but no further levels are gained. */
export function applyXp(level: number, xp: number, gained: number): XpResult {
  let l = level;
  let x = xp + Math.max(0, Math.floor(gained));
  const levelsGained: number[] = [];
  while (l < BALANCE.levels.cap && x >= xpToNext(l)) {
    x -= xpToNext(l);
    l++;
    levelsGained.push(l);
  }
  return { level: l, xp: x, levelsGained };
}
