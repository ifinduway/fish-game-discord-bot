export const GEAR = [
    { id: 'rod_common', slot: 'rod', tier: 'common', name: 'Бамбуковая удочка', emoji: '🎣', stats: { rarityBonus: 0.02, biteWindowMs: 100 }, shopPrice: 150, unlockLevel: 1 },
    { id: 'rod_uncommon', slot: 'rod', tier: 'uncommon', name: 'Карбоновая удочка', emoji: '🎣', stats: { rarityBonus: 0.05, biteWindowMs: 200 }, shopPrice: 600, unlockLevel: 5 },
    { id: 'reel_common', slot: 'reel', tier: 'common', name: 'Простая катушка', emoji: '⚙️', stats: { weightBonus: 0.03, reelTimeMs: 200 }, shopPrice: 150, unlockLevel: 1 },
    { id: 'line_common', slot: 'line', tier: 'common', name: 'Нейлоновая леска', emoji: '🧵', stats: { reelMistakes: 0, maxWeight: 15 }, shopPrice: 120, unlockLevel: 1 },
    { id: 'outfit_common', slot: 'outfit', tier: 'common', name: 'Панама рыбака', emoji: '🧥', stats: { maxEnergy: 5, castCostReduction: 0 }, shopPrice: 150, unlockLevel: 1 },
    { id: 'rod_legendary', slot: 'rod', tier: 'legendary', name: 'Удочка Посейдона', emoji: '🔱', stats: { rarityBonus: 0.3, biteWindowMs: 600 }, unlockLevel: 1 },
];
export const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));
//# sourceMappingURL=gear.js.map