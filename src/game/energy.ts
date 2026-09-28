// Energy (spec §1): lazy regeneration from (stored, updatedAt). Pure functions, no db/discord.
import { BALANCE } from '../config/balance.js';
import type { GearStats } from '../data/types.js';

const E = BALANCE.energy;

export interface EnergyParams {
  max: number;
  regenMsPerPoint: number;
}

/** Max energy = base + outfit bonus (rounded to an integer). */
export function maxEnergyFor(stats: GearStats): number {
  return Math.round(E.max + (stats.maxEnergy ?? 0));
}

/** Cast cost = base − reduction, never below BALANCE.energy.minCastCost. */
export function castCostFor(stats: GearStats): number {
  return Math.max(E.minCastCost, Math.round(E.castCost - (stats.castCostReduction ?? 0)));
}

/** ms per regenerated point; energyRegenBonus 0.1 → 10% faster. */
export function regenMsFor(stats: GearStats): number {
  const bonus = Math.max(0, stats.energyRegenBonus ?? 0);
  return Math.max(1, Math.round(E.regenMsPerPoint / (1 + bonus)));
}

export function energyParams(stats: GearStats): EnergyParams {
  return { max: maxEnergyFor(stats), regenMsPerPoint: regenMsFor(stats) };
}

/**
 * Current energy from the stored value. Regenerates only while below max; overflow (energy drinks)
 * is kept but never regenerates further.
 */
export function currentEnergy(stored: number, updatedAt: number, now: number, p: EnergyParams): number {
  if (stored >= p.max) return stored;
  const elapsed = Math.max(0, now - updatedAt);
  return Math.min(p.max, stored + elapsed / p.regenMsPerPoint);
}

/** ms until `current` reaches `target` by regeneration (0 if already there). Infinity if target > max. */
export function msUntil(current: number, target: number, p: EnergyParams): number {
  if (current >= target) return 0;
  if (target > p.max) return Infinity;
  return Math.ceil((target - current) * p.regenMsPerPoint);
}

export function msToFull(current: number, p: EnergyParams): number {
  return msUntil(current, p.max, p);
}

/** New energy after spending `cost`, or null if not enough. */
export function spend(current: number, cost: number): number | null {
  if (current + 1e-9 < cost) return null;
  return Math.max(0, current - cost);
}

/** Energy refunded on escape (8 → 4). */
export function escapeRefund(castCost: number): number {
  return castCost * E.escapeRefundFraction;
}

/** Adds a refund without pushing energy above max (overflow already present is kept). */
export function applyRefund(current: number, refund: number, max: number): number {
  return Math.min(current + refund, Math.max(current, max));
}

export type DrinkResult =
  | { ok: true; energy: number; gained: number; drinksUsed: number }
  | { ok: false; reason: 'limit' | 'full' };

/**
 * Energy drink: +drinkEnergy up to max × overflowCapFactor, at most drinksPerDay per day.
 * `drinksUsedToday` must already be reset by the caller when the day key changed.
 */
export function applyDrink(current: number, max: number, drinksUsedToday: number, amount: number = E.drinkEnergy): DrinkResult {
  if (drinksUsedToday >= E.drinksPerDay) return { ok: false, reason: 'limit' };
  const cap = max * E.overflowCapFactor;
  if (current >= cap) return { ok: false, reason: 'full' };
  const energy = Math.min(cap, current + amount);
  return { ok: true, energy, gained: energy - current, drinksUsed: drinksUsedToday + 1 };
}
