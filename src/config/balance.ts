// ALL numeric balance constants (spec §1–§12 + plan §8). Game logic must read numbers from here, never hard-code them.
import type { ChestId, LocationId, Rarity } from '../data/types.js';

type ByRarity = Record<Rarity, number>;

export const BALANCE = {
  // §1 Energy
  energy: {
    max: 100,
    castCost: 8,
    /** 1 energy per 2.4 minutes → 0→100 in 4 h */
    regenMsPerPoint: 144_000,
    /** refund fraction of cast cost on escape / miss (8 → 4) */
    escapeRefundFraction: 0.5,
    /** energy drink */
    drinkEnergy: 30,
    drinksPerDay: 3,
    /** drinks may push energy up to max × this */
    overflowCapFactor: 1.5,
    /** minimum cast cost after outfit reductions */
    minCastCost: 1,
  },

  // §2 Cast / hook / reel
  fishing: {
    biteDelayMinMs: 1500,
    biteDelayMaxMs: 5000,
    /** base hook window (plan §8.9) */
    hookWindowMs: 2000,
    /** added to the window to compensate Discord latency (not part of the perfect zone) */
    latencyGraceMs: 400,
    /** perfect hook = press within the first 40% of the BASE window */
    perfectFraction: 0.4,
    perfectQualityBonus: 1,
    perfectWeightBonus: 0.1,
    /** rare+ fish trigger the reel mini-game */
    reelMinRarity: 'rare' as Rarity,
    reelRoundsMin: 2,
    reelRoundsMax: 3,
    reelRoundTimeMs: 3000,
    reelDirections: 3,
    /** mistakes that make the fish escape (without line bonus) */
    reelMistakesToEscape: 2,
    /** quality stars lost per reel mistake */
    reelMistakeQualityPenalty: 1,
    /** fish heavier than line maxWeight snaps the line with this chance */
    lineSnapChance: 0.5,
    /** default line max weight when no line is equipped (kg) */
    baseLineMaxWeight: 10,
    /** fallback junk chance range (locations define their own junkChance within it) */
    junkChanceMin: 0.05,
    junkChanceMax: 0.1,
    treasureChance: 0.01,
    /** when treasure is found: chance it contains pearls instead of coins */
    treasurePearlShare: 0.5,
    treasurePearlsMin: 1,
    treasurePearlsMax: 3,
    treasureCoinsMin: 20,
    treasureCoinsMax: 100,
    /** base rarity odds (weights, sum 100) before bonuses */
    rarityWeights: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 0.9, mythic: 0.1 } as ByRarity,
    /** quality ★1..★5 roll weights (index 0 = ★1) */
    qualityWeights: [40, 30, 18, 9, 3],
    /** price multiplier by quality ★1..★5 (index 0 = ★1) */
    qualityMultipliers: [1.0, 1.2, 1.5, 2.0, 3.0],
    maxQuality: 5,
    /** XP per catch by rarity */
    xpByRarity: { common: 10, uncommon: 18, rare: 35, epic: 80, legendary: 200, mythic: 500 } as ByRarity,
    junkXp: 1,
    // --- WP2 additions ---
    /** rod/bait rarityBonus and bite-hour multiplier apply to rarities at or above this one */
    rarityBonusMinRarity: 'rare' as Rarity,
    /** minimum player level for a rarity to appear in the species roll */
    rarityMinLevel: { common: 1, uncommon: 1, rare: 1, epic: 3, legendary: 8, mythic: 15 } as ByRarity,
    /** weight multiplier for species listed in a bait's speciesBoost (within their rarity) */
    baitSpeciesBoost: 3,
    /** an unfinished fishing session older than this is considered abandoned */
    sessionTtlMs: 120_000,
  },

  // §3 Levels & locations
  levels: {
    cap: 100,
    /** xpToNext(level) = round(base × level^exponent) */
    base: 50,
    exponent: 1.3,
  },
  locationUnlockLevels: { pond: 1, river: 5, lake: 10, sea: 20, deep: 35 } as Record<LocationId, number>,

  // §4 Gear upgrades
  upgrade: {
    maxLevel: 5,
    /** +10% of every numeric stat per upgrade level */
    statBonusPerLevel: 0.1,
    /** cost(level→level+1) = baseCost[tier] × costGrowth^level */
    baseCost: { common: 100, uncommon: 200, rare: 400, epic: 800, legendary: 1600, mythic: 3200 } as ByRarity,
    costGrowth: 2,
  },
  /** duplicate gear from rewards/chests converts to coins (amendment §8.8) */
  gearDuplicateCoins: { common: 50, uncommon: 120, rare: 300, epic: 800, legendary: 2000, mythic: 5000 } as ByRarity,

  // §5 Economy
  cage: {
    baseCapacity: 50,
    upgradeStep: 25,
    maxCapacity: 200,
    /** price of n-th expansion (n = 0,1,2…) = upgradeBaseCost × 2^n (amendment §8.5) */
    upgradeBaseCost: 500,
  },
  /** first catch of a species (amendment §8.3) */
  firstCatchPearls: { common: 1, uncommon: 2, rare: 4, epic: 8, legendary: 15, mythic: 30 } as ByRarity,
  daily: {
    basePearls: 3,
    perStreakDay: 1,
    maxPearls: 10,
  },
  shop: {
    /** daily rotating offer discount */
    dailyOfferDiscount: 0.2,
    /** WP2: max quantity of a consumable per /buy */
    maxBuyQty: 50,
  },

  // §6 Chests
  chests: {
    prices: { wood: 10, silver: 30, gold: 80 } as Record<ChestId, number>,
    pity: {
      silver: { opens: 15, minRarity: 'epic' as Rarity },
      gold: { opens: 20, minRarity: 'legendary' as Rarity },
    },
    maxOpenCount: 5,
    /** spin animation (amendment §8.6) */
    spinEdits: 3,
    spinIntervalMs: 800,
  },

  // §7 Challenges
  challenges: {
    dailyCount: 3,
    weeklyCount: 4,
    seasonalMin: 10,
    seasonalMax: 15,
    dailyPearlsMin: 2,
    dailyPearlsMax: 3,
    allDailyBonusPearls: 5,
    weeklyPearlsMin: 10,
    weeklyPearlsMax: 15,
  },

  // §8 Season & pass (amendment §8.7)
  season: {
    durationDays: 28,
    topPlaces: 3,
  },
  pass: {
    levels: 30,
    xpPerLevel: 300,
  },
  passXp: {
    cast: 2,
    catchByRarity: { common: 3, uncommon: 5, rare: 10, epic: 20, legendary: 40, mythic: 80 } as ByRarity,
    dailyChallenge: 20,
    weeklyChallenge: 60,
    seasonalChallenge: 150,
    bossParticipation: 30,
  },

  // §9 Boss & server goal
  boss: {
    /** luxon weekday numbers (1 = Monday): Tuesday & Friday */
    scheduleWeekdays: [2, 5],
    scheduleHour: 18,
    durationHours: 24,
    /** max_hp = hpPerPlayer × max(minPlayers, active players in the last activeWindowDays) */
    minPlayers: 5,
    activeWindowDays: 7,
    /** damage = (damageBase + weight × damagePerKg) × qualityMultiplier × (perfect ? perfectMultiplier : 1) */
    damageBase: 10,
    damagePerKg: 5,
    perfectMultiplier: 1.5,
    /** reward tiers by contribution share (first matching tier wins) */
    rewardTiers: [
      { minShare: 0.1, pearls: 50, coins: 1000 },
      { minShare: 0.03, pearls: 30, coins: 500 },
      { minShare: 0, pearls: 10, coins: 200 },
    ],
    consolationPearls: 5,
    consolationCoins: 100,
    /** WP4: contributors shown on /boss card */
    topShown: 5,
  },
  serverGoal: {
    metric: 'total_weight',
    /** "Вместе поймать 5000 кг рыбы" */
    baseTarget: 5000,
    /** target = baseTarget × max(1, activePlayers / referencePlayers) */
    referencePlayers: 10,
    rewardPearls: 15,
    rewardCoins: 500,
    /** WP4: computed target is rounded up to a multiple of this */
    targetRounding: 100,
  },

  // §10 Leaderboards & events
  weekly: {
    /** top-1 of each weekly category */
    winnerPearls: 20,
  },
  events: {
    biteHourMinutes: 60,
    biteHourRarityMultiplier: 2,
    tournamentMinutes: 60,
    tournamentPrizes: [
      { pearls: 30, coins: 1000 },
      { pearls: 20, coins: 600 },
      { pearls: 10, coins: 300 },
    ],
    /** WP4: automatic events — at most one per local day, starting at a deterministic hour in [hourMin, hourMax] with `chance` */
    auto: {
      enabled: true,
      chance: 0.5,
      hourMin: 12,
      hourMax: 21,
    },
  },
  /** WP4: leaderboard size */
  leaderboard: {
    size: 10,
  },

  // §12 Blackjack
  blackjack: {
    minBet: 10,
    maxBetBase: 100,
    maxBetPerLevel: 50,
    handsPerDay: 20,
    decks: 6,
    /** total returned to the player (stake included) */
    winPayout: 2,
    blackjackPayout: 2.5,
    pushPayout: 1,
    timeoutMs: 60_000,
    maxFishOptions: 25,
  },

  // Discord timing rules (amendment §8.9)
  discord: {
    minAnimationIntervalMs: 800,
    maxCustomIdLength: 100,
    maxSelectOptions: 25,
  },
};

export type Balance = typeof BALANCE;
