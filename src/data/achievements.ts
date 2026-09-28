// WP1: multi-tier permanent achievements. `stat` must be one of the shared stats metric keys
// (plan §5 migration notes: casts, catches, perfects, total_weight, new_species, chests_opened,
// boss_damage, bj_wins, coins_earned, rare_plus, ...), always read from scope 'all'.
import type { AchievementDef } from './types.js';

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'catcher',
    name: 'Рыболов',
    stat: 'catches',
    tiers: [
      { threshold: 100, reward: { pearls: 10 } },
      { threshold: 1000, reward: { pearls: 30 }, title: 'title-angler' },
      { threshold: 10000, reward: { pearls: 100 } },
    ],
  },
  {
    id: 'caster',
    name: 'Терпеливый рыбак',
    stat: 'casts',
    tiers: [
      { threshold: 500, reward: { pearls: 10 } },
      { threshold: 5000, reward: { pearls: 25 } },
      { threshold: 50000, reward: { pearls: 75 } },
    ],
  },
  {
    id: 'perfectionist',
    name: 'Меткий глаз',
    stat: 'perfects',
    tiers: [
      { threshold: 50, reward: { pearls: 10 } },
      { threshold: 500, reward: { pearls: 25 } },
      { threshold: 5000, reward: { pearls: 75 } },
    ],
  },
  {
    id: 'heavyweight',
    name: 'Тяжёлая рука',
    stat: 'total_weight',
    tiers: [
      { threshold: 500, reward: { pearls: 10 } },
      { threshold: 5000, reward: { pearls: 30 } },
      { threshold: 50000, reward: { pearls: 100 } },
    ],
  },
  {
    id: 'collector',
    name: 'Коллекционер',
    stat: 'new_species',
    tiers: [
      { threshold: 10, reward: { pearls: 15 } },
      { threshold: 25, reward: { pearls: 30 }, title: 'title-collector' },
      { threshold: 50, reward: { pearls: 60, cosmetics: ['badge-collector'] } },
    ],
  },
  {
    id: 'treasure-hunter',
    name: 'Охотник за сундуками',
    stat: 'chests_opened',
    tiers: [
      { threshold: 10, reward: { pearls: 10 } },
      { threshold: 100, reward: { pearls: 25 } },
      { threshold: 500, reward: { pearls: 60 } },
    ],
  },
  {
    id: 'boss-hunter',
    name: 'Охотник на боссов',
    stat: 'boss_damage',
    tiers: [
      { threshold: 1000, reward: { pearls: 15 } },
      { threshold: 10000, reward: { pearls: 40 } },
      { threshold: 100000, reward: { pearls: 100, cosmetics: ['title-boss-slayer', 'badge-boss-slayer'] } },
    ],
  },
  {
    id: 'gambler',
    name: 'Везунчик за столом',
    stat: 'bj_wins',
    tiers: [
      { threshold: 10, reward: { pearls: 10 } },
      { threshold: 100, reward: { pearls: 25 } },
      { threshold: 500, reward: { pearls: 60 } },
    ],
  },
  {
    id: 'rich',
    name: 'Рыбный магнат',
    stat: 'coins_earned',
    tiers: [
      { threshold: 10000, reward: { pearls: 10 } },
      { threshold: 100000, reward: { pearls: 30 } },
      { threshold: 1000000, reward: { pearls: 80 } },
    ],
  },
  {
    id: 'rare-hunter',
    name: 'Охотник за редкостями',
    stat: 'rare_plus',
    tiers: [
      { threshold: 25, reward: { pearls: 15 } },
      { threshold: 250, reward: { pearls: 35 } },
      { threshold: 2500, reward: { pearls: 90, cosmetics: ['title-legend'] } },
    ],
  },
];
