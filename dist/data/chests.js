// STUB (WP0) — WP1 replaces the loot tables but must keep export names/types.
import { BALANCE } from '../config/balance.js';
const P = BALANCE.chests.prices;
export const CHESTS = [
    {
        id: 'wood',
        name: 'Деревянный сундук',
        emoji: '🪵',
        price: P.wood,
        loot: [
            { weight: 50, rarity: 'common', kind: 'coins', min: 50, max: 150 },
            { weight: 30, rarity: 'common', kind: 'item', itemId: 'bait_worm', qty: 3 },
            { weight: 15, rarity: 'uncommon', kind: 'item', itemId: 'energy_drink', qty: 1 },
            { weight: 5, rarity: 'common', kind: 'gear', tier: 'common' },
        ],
    },
    {
        id: 'silver',
        name: 'Серебряный сундук',
        emoji: '🥈',
        price: P.silver,
        loot: [
            { weight: 45, rarity: 'uncommon', kind: 'coins', min: 200, max: 500 },
            { weight: 30, rarity: 'uncommon', kind: 'gear', tier: 'uncommon' },
            { weight: 15, rarity: 'rare', kind: 'cosmetic', cosmeticType: 'frame', tier: 'rare' },
            { weight: 10, rarity: 'epic', kind: 'gear', tier: 'epic' },
        ],
        pity: BALANCE.chests.pity.silver,
    },
    {
        id: 'gold',
        name: 'Золотой сундук',
        emoji: '🥇',
        price: P.gold,
        loot: [
            { weight: 50, rarity: 'rare', kind: 'coins', min: 800, max: 1500 },
            { weight: 30, rarity: 'epic', kind: 'cosmetic', cosmeticType: 'background', tier: 'epic' },
            { weight: 15, rarity: 'legendary', kind: 'gear', tier: 'legendary' },
            { weight: 5, rarity: 'rare', kind: 'cosmetic', cosmeticType: 'title', tier: 'rare' },
        ],
        pity: BALANCE.chests.pity.gold,
    },
];
export const CHEST_BY_ID = Object.fromEntries(CHESTS.map((c) => [c.id, c]));
//# sourceMappingURL=chests.js.map