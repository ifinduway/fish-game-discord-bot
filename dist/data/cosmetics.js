export const COSMETICS = [
    { id: 'title_novice', type: 'title', name: 'Новичок', rarity: 'common' },
    { id: 'title_angler', type: 'title', name: 'Заядлый рыбак', rarity: 'rare' },
    { id: 'frame_silver', type: 'frame', name: 'Серебряная рамка', rarity: 'rare', color: '#c0c0c0' },
    { id: 'bg_ocean', type: 'background', name: 'Океан', rarity: 'epic', gradient: ['#0f2027', '#2c5364'] },
    { id: 'badge_winter', type: 'badge', name: 'Значок «Зима»', rarity: 'epic', color: '#9be7ff' },
];
export const COSMETIC_BY_ID = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));
//# sourceMappingURL=cosmetics.js.map