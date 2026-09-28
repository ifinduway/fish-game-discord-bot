// WP1: chest loot tables. Weights are relative (need not sum to 100) but are chosen so that
// the gold chest's natural legendary+ chance lands around 3-5% (pity still guarantees it
// within BALANCE.chests.pity.gold.opens). Keep export names/types stable.
import { BALANCE } from '../config/balance.js';
import type { ChestDef, ChestId } from './types.js';

const P = BALANCE.chests.prices;

export const CHESTS: ChestDef[] = [
  {
    id: 'wood',
    name: 'Деревянный сундук',
    emoji: '🪵',
    price: P.wood,
    loot: [
      { weight: 45, rarity: 'common', kind: 'coins', min: 50, max: 150 },
      { weight: 25, rarity: 'common', kind: 'item', itemId: 'bait-worm', qty: 3 },
      { weight: 15, rarity: 'common', kind: 'item', itemId: 'energy-drink', qty: 1 },
      { weight: 10, rarity: 'common', kind: 'gear', tier: 'common' },
      { weight: 5, rarity: 'common', kind: 'item', itemId: 'bait-dough', qty: 2 },
    ],
  },
  {
    id: 'silver',
    name: 'Серебряный сундук',
    emoji: '🥈',
    price: P.silver,
    loot: [
      { weight: 40, rarity: 'uncommon', kind: 'coins', min: 200, max: 500 },
      { weight: 25, rarity: 'uncommon', kind: 'gear', tier: 'uncommon' },
      { weight: 20, rarity: 'rare', kind: 'cosmetic', cosmeticType: 'frame', tier: 'rare' },
      { weight: 10, rarity: 'rare', kind: 'gear', tier: 'rare' },
      { weight: 4, rarity: 'epic', kind: 'gear', tier: 'epic' },
      { weight: 1, rarity: 'epic', kind: 'cosmetic', cosmeticType: 'background', tier: 'epic' },
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
      { weight: 28, rarity: 'epic', kind: 'gear', tier: 'epic' },
      { weight: 18, rarity: 'epic', kind: 'cosmetic', cosmeticType: 'background', tier: 'epic' },
      { weight: 2, rarity: 'legendary', kind: 'gear', tier: 'legendary' },
      { weight: 1, rarity: 'legendary', kind: 'cosmetic', cosmeticType: 'title', tier: 'legendary' },
      { weight: 0.7, rarity: 'mythic', kind: 'gear', tier: 'mythic' },
      { weight: 0.3, rarity: 'mythic', kind: 'cosmetic', cosmeticType: 'frame', tier: 'mythic' },
    ],
    pity: BALANCE.chests.pity.gold,
  },
];

export const CHEST_BY_ID: Record<ChestId, ChestDef> = Object.fromEntries(CHESTS.map((c) => [c.id, c])) as Record<ChestId, ChestDef>;
