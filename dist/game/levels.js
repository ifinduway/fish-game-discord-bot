// Player XP curve (pure). players.xp stores progress INSIDE the current level.
import { BALANCE } from '../config/balance.js';
/** XP needed to go from `level` to `level + 1`. Infinity at the level cap. */
export function xpToNext(level) {
    if (level >= BALANCE.levels.cap)
        return Infinity;
    return Math.round(BALANCE.levels.base * Math.pow(Math.max(1, level), BALANCE.levels.exponent));
}
/** Total XP accumulated from level 1 / 0 xp to reach (level, xp). */
export function totalXp(level, xp) {
    let sum = xp;
    for (let l = 1; l < level; l++)
        sum += xpToNext(l);
    return sum;
}
/** Applies gained XP. At the cap, extra XP is kept but no further levels are gained. */
export function applyXp(level, xp, gained) {
    let l = level;
    let x = xp + Math.max(0, Math.floor(gained));
    const levelsGained = [];
    while (l < BALANCE.levels.cap && x >= xpToNext(l)) {
        x -= xpToNext(l);
        l++;
        levelsGained.push(l);
    }
    return { level: l, xp: x, levelsGained };
}
//# sourceMappingURL=levels.js.map