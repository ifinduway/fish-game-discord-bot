export const FISH = [
    { id: 'crucian', name: 'Карась', emoji: '🐟', rarity: 'common', locations: ['pond'], minWeight: 0.1, maxWeight: 0.8, basePrice: 10, description: 'Неприхотливый житель прудов.' },
    { id: 'roach', name: 'Плотва', emoji: '🐟', rarity: 'uncommon', locations: ['pond'], minWeight: 0.1, maxWeight: 0.6, basePrice: 18, description: 'Серебристая и шустрая.' },
    { id: 'tench', name: 'Линь', emoji: '🐠', rarity: 'rare', locations: ['pond'], times: ['morning', 'evening'], minWeight: 0.5, maxWeight: 3, basePrice: 45, description: 'Любит тину и тишину.' },
    { id: 'golden_carp', name: 'Золотой карп', emoji: '🐡', rarity: 'epic', locations: ['pond'], minWeight: 2, maxWeight: 8, basePrice: 120, description: 'Говорят, исполняет желания.' },
    { id: 'pond_king', name: 'Царь пруда', emoji: '👑', rarity: 'legendary', locations: ['pond'], times: ['night'], minWeight: 8, maxWeight: 20, basePrice: 400, description: 'Старейший обитатель пруда.' },
    { id: 'moon_koi', name: 'Лунный кои', emoji: '🌙', rarity: 'mythic', locations: ['pond'], times: ['night'], minWeight: 5, maxWeight: 12, basePrice: 1200, description: 'Светится в лунном свете.' },
    { id: 'perch', name: 'Окунь', emoji: '🐟', rarity: 'common', locations: ['river'], minWeight: 0.1, maxWeight: 1.5, basePrice: 14, description: 'Полосатый разбойник.' },
    { id: 'pike', name: 'Щука', emoji: '🐊', rarity: 'common', locations: ['lake'], minWeight: 1, maxWeight: 10, basePrice: 25, description: 'Зубастая хищница.' },
    { id: 'herring', name: 'Сельдь', emoji: '🐟', rarity: 'common', locations: ['sea'], minWeight: 0.2, maxWeight: 1, basePrice: 30, description: 'Идёт косяками.' },
    { id: 'anglerfish', name: 'Удильщик', emoji: '🏮', rarity: 'common', locations: ['deep'], minWeight: 2, maxWeight: 15, basePrice: 60, description: 'Сам себе фонарик.' },
    { id: 'snow_char', name: 'Снежный голец', emoji: '❄️', rarity: 'rare', locations: ['lake'], seasonTheme: 'winter', minWeight: 1, maxWeight: 5, basePrice: 90, description: 'Появляется только зимой.' },
];
export const FISH_BY_ID = Object.fromEntries(FISH.map((f) => [f.id, f]));
export const JUNK_ITEMS = [
    { id: 'boot', name: 'Старый ботинок', emoji: '🥾', coins: 1 },
    { id: 'seaweed', name: 'Водоросли', emoji: '🌿', coins: 0 },
];
//# sourceMappingURL=fish.js.map