// ALL catalog types (plan §4.5 + amendments §8). WP1 fills the catalogs; the shapes here are the contract.

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

/** Ordered from lowest to highest. Use `rarityIndex` for comparisons. */
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export const RARITY_INFO: Record<Rarity, { name: string; color: number; emoji: string }> = {
  common: { name: 'Обычная', color: 0x9e9e9e, emoji: '⚪' },
  uncommon: { name: 'Необычная', color: 0x4caf50, emoji: '🟢' },
  rare: { name: 'Редкая', color: 0x2196f3, emoji: '🔵' },
  epic: { name: 'Эпическая', color: 0x9c27b0, emoji: '🟣' },
  legendary: { name: 'Легендарная', color: 0xff9800, emoji: '🟠' },
  mythic: { name: 'Мифическая', color: 0xf44336, emoji: '🔴' },
};

/** 0 for common … 5 for mythic. */
export function rarityIndex(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** true if `r` is the same or higher than `min`. */
export function rarityAtLeast(r: Rarity, min: Rarity): boolean {
  return rarityIndex(r) >= rarityIndex(min);
}

export type LocationId = 'pond' | 'river' | 'lake' | 'sea' | 'deep';
export const LOCATION_IDS: LocationId[] = ['pond', 'river', 'lake', 'sea', 'deep'];

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

export type SeasonThemeId = 'winter' | 'spring' | 'summer' | 'autumn';

export interface FishSpecies {
  id: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  locations: LocationId[];
  times?: TimeOfDay[];
  minWeight: number;
  maxWeight: number;
  basePrice: number;
  seasonTheme?: SeasonThemeId;
  description: string;
}

export interface JunkItem {
  id: string;
  name: string;
  emoji: string;
  /** coins granted when fished out (may be 0) */
  coins: number;
}

export interface LocationDef {
  id: LocationId;
  name: string;
  emoji: string;
  unlockLevel: number;
  description: string;
  junkChance: number;
}

export type GearSlot = 'rod' | 'reel' | 'line' | 'outfit';
export const GEAR_SLOTS: GearSlot[] = ['rod', 'reel', 'line', 'outfit'];

export interface GearStats {
  rarityBonus?: number /* additive multiplier e.g. 0.1 */;
  biteWindowMs?: number;
  weightBonus?: number;
  reelTimeMs?: number;
  reelMistakes?: number;
  maxWeight?: number;
  maxEnergy?: number;
  castCostReduction?: number;
  energyRegenBonus?: number;
}

export interface GearDef {
  id: string;
  slot: GearSlot;
  tier: Rarity;
  name: string;
  emoji: string;
  stats: GearStats;
  shopPrice?: number /* undefined → not in shop */;
  unlockLevel: number;
}

export type ConsumableKind = 'energy' | 'bait';

export interface ConsumableDef {
  id: string;
  kind: ConsumableKind;
  name: string;
  emoji: string;
  description: string;
  shopPrice?: number;
  energy?: number;
  bait?: { casts: number; rarityBonus?: number; speciesBoost?: string[]; timeOfDay?: TimeOfDay[] };
}

export type CosmeticType = 'title' | 'frame' | 'background' | 'badge';

export interface CosmeticDef {
  id: string;
  type: CosmeticType;
  name: string;
  rarity: Rarity;
  color?: string;
  gradient?: [string, string];
}

export type ChestId = 'wood' | 'silver' | 'gold';

export type LootEntry = { weight: number; rarity: Rarity } & (
  | { kind: 'coins'; min: number; max: number }
  | { kind: 'item'; itemId: string; qty: number }
  | { kind: 'gear'; tier: Rarity }
  | { kind: 'cosmetic'; cosmeticType: CosmeticType; tier: Rarity }
);

export interface ChestDef {
  id: ChestId;
  name: string;
  emoji: string;
  price: number /* pearls */;
  loot: LootEntry[];
  pity?: { opens: number; minRarity: Rarity };
}

export type ChallengeScope = 'daily' | 'weekly' | 'seasonal';

export type ChallengeMetric =
  | 'catch'
  | 'catch_rare_plus'
  | 'catch_epic_plus'
  | 'perfect'
  | 'sell_coins'
  | 'cast_at_location'
  | 'catch_heavier_than'
  | 'open_chest'
  | 'boss_damage'
  | 'new_species'
  | 'blackjack_hands'
  | 'total_weight'
  | 'catch_seasonal'
  | 'spend_coins'
  | 'upgrade_gear';

/** Reward bundle (plan §4.3). Defined here so data files can use it without importing services. */
export interface Reward {
  coins?: number;
  pearls?: number;
  xp?: number;
  passXp?: number;
  /** consumables & baits */
  items?: { itemId: string; qty: number }[];
  /** gear catalog ids → new gear_items rows (duplicates → coins per BALANCE.gearDuplicateCoins[tier]) */
  gear?: string[];
  /** titles/frames/backgrounds/badges (duplicates ignored) */
  cosmetics?: string[];
}

export interface ChallengeTemplate {
  id: string;
  scope: ChallengeScope;
  metric: ChallengeMetric;
  param?: string /* location id or kg */;
  target: [number, number] /* min,max roll */;
  title: string /* with {n} {param} placeholders */;
  reward: Reward;
  passXp: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  stat: string /* stats metric key, scope 'all' */;
  tiers: { threshold: number; reward: Reward; title?: string }[];
}

export interface SeasonTheme {
  id: SeasonThemeId;
  name: string;
  emoji: string;
  colors: [string, string];
}

export interface PassLevelReward {
  level: number;
  reward: Reward;
}

export interface BossDef {
  id: string;
  name: string;
  emoji: string;
  location: LocationId;
  hpPerPlayer: number;
  description: string;
}

/** Shop listing (amendment §8.5). `refId` points to GEAR/CONSUMABLES for kind gear/consumable; price overrides the catalog shopPrice. */
export interface ShopListing {
  id: string;
  kind: 'gear' | 'consumable' | 'cage';
  refId?: string;
  price?: number;
  unlockLevel: number;
}
