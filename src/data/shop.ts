// WP1: shop listings — gear common..rare, all shop-priced consumables, and the cage upgrade
// listing (amendment §8.5: kind 'cage', price computed by the shop service from
// BALANCE.cage.upgradeBaseCost × 2^n). Keep export names/types stable.
import type { ShopListing } from './types.js';

export const SHOP_LISTINGS: ShopListing[] = [
  // Gear (common..rare only — epic+ is chest/pass/boss exclusive)
  { id: 'rod-common', kind: 'gear', refId: 'rod-common', unlockLevel: 1 },
  { id: 'rod-uncommon', kind: 'gear', refId: 'rod-uncommon', unlockLevel: 5 },
  { id: 'rod-rare', kind: 'gear', refId: 'rod-rare', unlockLevel: 10 },
  { id: 'reel-common', kind: 'gear', refId: 'reel-common', unlockLevel: 1 },
  { id: 'reel-uncommon', kind: 'gear', refId: 'reel-uncommon', unlockLevel: 5 },
  { id: 'reel-rare', kind: 'gear', refId: 'reel-rare', unlockLevel: 10 },
  { id: 'line-common', kind: 'gear', refId: 'line-common', unlockLevel: 1 },
  { id: 'line-uncommon', kind: 'gear', refId: 'line-uncommon', unlockLevel: 5 },
  { id: 'line-rare', kind: 'gear', refId: 'line-rare', unlockLevel: 10 },
  { id: 'outfit-common', kind: 'gear', refId: 'outfit-common', unlockLevel: 1 },
  { id: 'outfit-uncommon', kind: 'gear', refId: 'outfit-uncommon', unlockLevel: 5 },
  { id: 'outfit-rare', kind: 'gear', refId: 'outfit-rare', unlockLevel: 10 },

  // Consumables (all with a shopPrice)
  { id: 'energy-drink', kind: 'consumable', refId: 'energy-drink', unlockLevel: 1 },
  { id: 'bait-worm', kind: 'consumable', refId: 'bait-worm', unlockLevel: 1 },
  { id: 'bait-dough', kind: 'consumable', refId: 'bait-dough', unlockLevel: 1 },
  { id: 'bait-luminous', kind: 'consumable', refId: 'bait-luminous', unlockLevel: 5 },
  { id: 'bait-golden', kind: 'consumable', refId: 'bait-golden', unlockLevel: 10 },
  { id: 'bait-shrimp', kind: 'consumable', refId: 'bait-shrimp', unlockLevel: 20 },

  // Cage capacity expansion (price computed at purchase time from BALANCE.cage)
  { id: 'cage-upgrade', kind: 'cage', unlockLevel: 1 },
];
