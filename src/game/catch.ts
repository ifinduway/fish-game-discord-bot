// Cast outcome rolls (spec §2–§3): junk / treasure / species, weight, quality. Pure (injected rng).
import { BALANCE } from '../config/balance.js';
import type { Rng } from '../core/rng.js';
import {
  RARITIES,
  rarityAtLeast,
  type FishSpecies,
  type JunkItem,
  type LocationId,
  type Rarity,
  type SeasonThemeId,
  type TimeOfDay,
} from '../data/types.js';

const F = BALANCE.fishing;

export interface PoolFilter {
  location: LocationId;
  timeOfDay: TimeOfDay;
  level: number;
  /** theme of the active season (seasonal species of other themes are excluded) */
  seasonTheme: SeasonThemeId | null;
}

export interface RollContext extends PoolFilter {
  /** additive rarity bonus (rod + bait), applied to rarities ≥ BALANCE.fishing.rarityBonusMinRarity */
  rarityBonus: number;
  /** multiplicative modifier for the same rarities (bite hour = 2) */
  rarityMultiplier: number;
  /** bait-boosted species ids */
  speciesBoost?: readonly string[];
}

/** True if the player's level allows this rarity to appear. */
export function rarityAllowed(r: Rarity, level: number): boolean {
  return level >= F.rarityMinLevel[r];
}

/** Species catchable under the filter (location, time of day, level, active season). */
export function speciesPool(species: readonly FishSpecies[], f: PoolFilter, ignoreTime = false): FishSpecies[] {
  return species.filter(
    (s) =>
      s.locations.includes(f.location) &&
      (ignoreTime || !s.times || s.times.length === 0 || s.times.includes(f.timeOfDay)) &&
      (!s.seasonTheme || s.seasonTheme === f.seasonTheme) &&
      rarityAllowed(s.rarity, f.level),
  );
}

/** Rarity weights restricted to `available`, with the bonus/multiplier applied to rare+ rarities. */
export function rarityWeights(available: Iterable<Rarity>, rarityBonus = 0, rarityMultiplier = 1): { item: Rarity; weight: number }[] {
  const set = new Set(available);
  return RARITIES.filter((r) => set.has(r)).map((r) => {
    let weight = F.rarityWeights[r];
    if (rarityAtLeast(r, F.rarityBonusMinRarity)) weight *= (1 + Math.max(0, rarityBonus)) * Math.max(0, rarityMultiplier);
    return { item: r, weight };
  });
}

/** Rolls a species, or null when nothing is catchable. Falls back to ignoring time of day if the pool is empty. */
export function rollSpecies(rng: Rng, species: readonly FishSpecies[], rc: RollContext): FishSpecies | null {
  let pool = speciesPool(species, rc);
  if (pool.length === 0) pool = speciesPool(species, rc, true);
  if (pool.length === 0) return null;
  const rarity = rng.weighted(rarityWeights(pool.map((s) => s.rarity), rc.rarityBonus, rc.rarityMultiplier));
  const boost = new Set(rc.speciesBoost ?? []);
  const candidates = pool.filter((s) => s.rarity === rarity);
  return rng.weighted(candidates.map((s) => ({ item: s, weight: boost.has(s.id) ? F.baitSpeciesBoost : 1 })));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Weight in the species range × (1 + reel weightBonus). */
export function rollWeight(rng: Rng, s: Pick<FishSpecies, 'minWeight' | 'maxWeight'>, weightBonus = 0): number {
  return Math.max(0.01, round2(rng.float(s.minWeight, s.maxWeight) * (1 + Math.max(0, weightBonus))));
}

/** Weight after the perfect-hook bonus (+10%). */
export function perfectWeight(weight: number): number {
  return round2(weight * (1 + F.perfectWeightBonus));
}

/** Base quality ★1..★5 from BALANCE.fishing.qualityWeights. */
export function rollQuality(rng: Rng): number {
  return rng.weighted(F.qualityWeights.map((weight, i) => ({ item: i + 1, weight })));
}

/** Final quality: +1 on perfect hook, −1 per reel mistake, clamped to [1, maxQuality]. */
export function finalQuality(base: number, perfect: boolean, mistakes: number): number {
  const q = base + (perfect ? F.perfectQualityBonus : 0) - Math.max(0, mistakes) * F.reelMistakeQualityPenalty;
  return Math.max(1, Math.min(F.maxQuality, q));
}

export function catchXp(r: Rarity): number {
  return F.xpByRarity[r];
}

/** Location junk chance clamped into the configured range. */
export function effectiveJunkChance(locationJunkChance: number | undefined): number {
  const c = locationJunkChance ?? F.junkChanceMin;
  return Math.max(F.junkChanceMin, Math.min(F.junkChanceMax, c));
}

export type CastRoll =
  | { kind: 'junk'; item: JunkItem }
  | { kind: 'treasure'; coins: number; pearls: number }
  | { kind: 'fish'; species: FishSpecies; weight: number; snap: boolean };

export interface CastRollInput {
  species: readonly FishSpecies[];
  junk: readonly JunkItem[];
  junkChance: number;
  rc: RollContext;
  weightBonus: number;
  /** line max weight (kg): heavier fish snap with BALANCE.fishing.lineSnapChance */
  maxWeight: number;
}

export function rollTreasure(rng: Rng): { coins: number; pearls: number } {
  if (rng.chance(F.treasurePearlShare)) return { coins: 0, pearls: rng.int(F.treasurePearlsMin, F.treasurePearlsMax) };
  return { coins: rng.int(F.treasureCoinsMin, F.treasureCoinsMax), pearls: 0 };
}

/** Pre-rolls the whole cast outcome (resolved later by the hook/reel mini-game). */
export function rollCast(rng: Rng, input: CastRollInput): CastRoll {
  const r = rng.next();
  const junkItem = (): CastRoll => ({ kind: 'junk', item: input.junk.length > 0 ? rng.pick(input.junk) : { id: 'junk', name: 'Мусор', emoji: '🗑️', coins: 0 } });
  if (r < F.treasureChance) return { kind: 'treasure', ...rollTreasure(rng) };
  if (r < F.treasureChance + input.junkChance) return junkItem();
  const species = rollSpecies(rng, input.species, input.rc);
  if (!species) return junkItem();
  const weight = rollWeight(rng, species, input.weightBonus);
  const snap = weight > input.maxWeight && rng.chance(F.lineSnapChance);
  return { kind: 'fish', species, weight, snap };
}
