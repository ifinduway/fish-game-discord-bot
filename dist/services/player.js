import { BALANCE } from '../config/balance.js';
import { LOCATIONS } from '../data/locations.js';
import { applyXp } from '../game/levels.js';
import { createPlayer, getPlayer, updatePlayer } from '../db/repos/players.js';
/**
 * Returns the player, creating it with full base energy if missing.
 * Updates the stored username when a non-empty different one is given.
 */
export function getOrCreatePlayer(ctx, userId, username) {
    const existing = getPlayer(ctx, userId);
    if (existing) {
        if (username && username !== existing.username) {
            updatePlayer(ctx, userId, { username });
            existing.username = username;
        }
        return existing;
    }
    return createPlayer(ctx, userId, username ?? '', BALANCE.energy.max, ctx.clock.now(), BALANCE.cage.baseCapacity);
}
/**
 * Adds XP (in the caller's transaction if any), handles level-ups, emits `level_up` for each new level
 * and returns notices (level-up text, unlocked locations, subscriber notices).
 */
export function addXp(ctx, userId, amount) {
    const p = getOrCreatePlayer(ctx, userId);
    const res = applyXp(p.level, p.xp, amount);
    updatePlayer(ctx, userId, { level: res.level, xp: res.xp });
    const notices = [];
    for (const level of res.levelsGained) {
        notices.push({ userId, text: `🎉 Новый уровень: **${level}**!` });
        for (const loc of LOCATIONS) {
            if (loc.unlockLevel === level)
                notices.push({ userId, text: `🗺️ Открыта локация: ${loc.emoji} ${loc.name}` });
        }
        notices.push(...ctx.bus.emit({ type: 'level_up', userId, level }, ctx));
    }
    return { ...res, notices };
}
//# sourceMappingURL=player.js.map