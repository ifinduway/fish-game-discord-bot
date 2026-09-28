// Economy formulas (spec §5). Pure.
import { BALANCE } from '../config/balance.js';
import type { FishSpecies } from '../data/types.js';

/** Price multiplier for quality ★1..★5 (clamped). */
export function qualityMultiplier(quality: number): number {
  const m = BALANCE.fishing.qualityMultipliers;
  const idx = Math.max(1, Math.min(m.length, Math.round(quality))) - 1;
  return m[idx]!;
}

export function averageWeight(species: Pick<FishSpecies, 'minWeight' | 'maxWeight'>): number {
  return (species.minWeight + species.maxWeight) / 2;
}

/** Sell value = round(base × (weight / avgWeight) × qualityMultiplier), at least 1. */
export function fishValue(species: Pick<FishSpecies, 'basePrice' | 'minWeight' | 'maxWeight'>, weight: number, quality: number): number {
  const avg = averageWeight(species);
  const ratio = avg > 0 ? weight / avg : 1;
  return Math.max(1, Math.round(species.basePrice * ratio * qualityMultiplier(quality)));
}

export type DailyResult = { ok: true; streak: number; pearls: number } | { ok: false; reason: 'already_claimed' };

/**
 * Daily login: pearls = base + perStreakDay × (streak − 1), capped at maxPearls.
 * The streak continues only if the last claim was yesterday; otherwise it resets to 1.
 */
export function dailyReward(lastKey: string | null, streak: number, todayKey: string, yesterdayKey: string): DailyResult {
  if (lastKey === todayKey) return { ok: false, reason: 'already_claimed' };
  const newStreak = lastKey === yesterdayKey ? Math.max(0, streak) + 1 : 1;
  const d = BALANCE.daily;
  const pearls = Math.min(d.maxPearls, d.basePearls + d.perStreakDay * (newStreak - 1));
  return { ok: true, streak: newStreak, pearls };
}

/** Price of the next cage expansion (base × 2^n), or null when at max capacity. */
export function cageUpgradeCost(capacity: number): number | null {
  const c = BALANCE.cage;
  if (capacity + c.upgradeStep > c.maxCapacity) return null;
  const n = Math.max(0, Math.round((capacity - c.baseCapacity) / c.upgradeStep));
  return c.upgradeBaseCost * Math.pow(2, n);
}

/** Deterministic index in [0, n) from a string key (FNV-1a). */
export function hashIndex(key: string, n: number): number {
  if (n <= 0) return -1;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % n;
}

/** Discounted price (at least 1). */
export function discounted(price: number, discount: number = BALANCE.shop.dailyOfferDiscount): number {
  return Math.max(1, Math.round(price * (1 - discount)));
}
