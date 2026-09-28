// WP1: season pass rewards, 30 levels (BALANCE.pass.levels). Reward is a mix of coins,
// pearls, consumables, gear and cosmetics (chests aren't grantable directly — they're bought
// with pearls, so pearls stand in for "a chest's worth" of value). Level 30 carries an
// exclusive cosmetic. Keep export names/types stable.
import { BALANCE } from '../config/balance.js';
import type { PassLevelReward } from './types.js';

export const PASS_REWARDS: PassLevelReward[] = [
  { level: 1, reward: { coins: 100 } },
  { level: 2, reward: { coins: 120 } },
  { level: 3, reward: { pearls: 2 } },
  { level: 4, reward: { coins: 150 } },
  { level: 5, reward: { pearls: 5, items: [{ itemId: 'energy-drink', qty: 1 }] } },
  { level: 6, reward: { coins: 180 } },
  { level: 7, reward: { pearls: 3 } },
  { level: 8, reward: { coins: 200 } },
  { level: 9, reward: { pearls: 3 } },
  { level: 10, reward: { coins: 100, gear: ['line-uncommon'] } },
  { level: 11, reward: { coins: 220 } },
  { level: 12, reward: { pearls: 4 } },
  { level: 13, reward: { coins: 250 } },
  { level: 14, reward: { pearls: 4 } },
  { level: 15, reward: { pearls: 8, items: [{ itemId: 'bait-golden', qty: 2 }] } },
  { level: 16, reward: { coins: 280 } },
  { level: 17, reward: { pearls: 5 } },
  { level: 18, reward: { coins: 300 } },
  { level: 19, reward: { pearls: 5 } },
  { level: 20, reward: { pearls: 10, gear: ['reel-rare'] } },
  { level: 21, reward: { coins: 350 } },
  { level: 22, reward: { pearls: 6 } },
  { level: 23, reward: { coins: 380 } },
  { level: 24, reward: { pearls: 6 } },
  { level: 25, reward: { pearls: 12, cosmetics: ['frame-gold'] } },
  { level: 26, reward: { coins: 400 } },
  { level: 27, reward: { pearls: 7 } },
  { level: 28, reward: { coins: 450 } },
  { level: 29, reward: { pearls: 8 } },
  { level: 30, reward: { pearls: 25, coins: 1000, cosmetics: ['title-season-master'] } },
];

if (PASS_REWARDS.length !== BALANCE.pass.levels) {
  throw new Error(`PASS_REWARDS must have exactly ${BALANCE.pass.levels} levels, got ${PASS_REWARDS.length}`);
}
