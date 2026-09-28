// ALL catalog types (plan §4.5 + amendments §8). WP1 fills the catalogs; the shapes here are the contract.
/** Ordered from lowest to highest. Use `rarityIndex` for comparisons. */
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const RARITY_INFO = {
    common: { name: 'Обычная', color: 0x9e9e9e, emoji: '⚪' },
    uncommon: { name: 'Необычная', color: 0x4caf50, emoji: '🟢' },
    rare: { name: 'Редкая', color: 0x2196f3, emoji: '🔵' },
    epic: { name: 'Эпическая', color: 0x9c27b0, emoji: '🟣' },
    legendary: { name: 'Легендарная', color: 0xff9800, emoji: '🟠' },
    mythic: { name: 'Мифическая', color: 0xf44336, emoji: '🔴' },
};
/** 0 for common … 5 for mythic. */
export function rarityIndex(r) {
    return RARITIES.indexOf(r);
}
/** true if `r` is the same or higher than `min`. */
export function rarityAtLeast(r, min) {
    return rarityIndex(r) >= rarityIndex(min);
}
export const LOCATION_IDS = ['pond', 'river', 'lake', 'sea', 'deep'];
export const GEAR_SLOTS = ['rod', 'reel', 'line', 'outfit'];
//# sourceMappingURL=types.js.map