// Chest opening: one transaction (spend pearls, roll, pity, grant), events after commit.
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { GameEvent, Notice } from '../core/events.js';
import { CHEST_BY_ID } from '../data/chests.js';
import { GEAR_BY_ID } from '../data/gear.js';
import type { ChestDef, ChestId, CosmeticType, Rarity, Reward } from '../data/types.js';
import { hasGear, listCosmetics } from '../db/repos/inventory.js';
import { requirePlayer, updatePlayer, type PlayerRow } from '../db/repos/players.js';
import { InsufficientFundsError, spendPearls } from '../db/repos/wallet.js';
import { chestPity, nextPityCounter, pityLeft, resolveLoot, rollChest, type LootKind } from '../game/chest.js';
import { getOrCreatePlayer } from './player.js';
import { grantReward } from './rewards.js';

export { chestOdds, type OddsRow } from '../game/chest.js';

/** User-facing (Russian) chest error. */
export class ChestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChestError';
  }
}

export interface OpenedChestReward {
  rarity: Rarity;
  kind: LootKind;
  label: string;
  cosmeticType?: CosmeticType;
  /** gear/cosmetic duplicate converted to coins */
  duplicate: boolean;
  forcedByPity: boolean;
  reward: Reward;
  /** grantReward summary (what was actually credited) */
  summary: string;
}

export interface ChestOpenResult {
  chest: ChestDef;
  count: number;
  pearlsSpent: number;
  pearlsLeft: number;
  rewards: OpenedChestReward[];
  /** null for chests without pity */
  pity: { counter: number; left: number; opens: number; minRarity: Rarity } | null;
  notices: Notice[];
}

type PityColumn = 'pity_silver' | 'pity_gold';

/** Player column holding the pity counter of a chest (wood has none). */
export function pityColumn(chestId: ChestId): PityColumn | null {
  if (chestId === 'silver') return 'pity_silver';
  if (chestId === 'gold') return 'pity_gold';
  return null;
}

export function getChestDef(chestId: string): ChestDef {
  const def = (CHEST_BY_ID as Partial<Record<string, ChestDef>>)[chestId];
  if (!def) throw new ChestError('Такого сундука нет 🤔');
  return def;
}

/** Current pity counter of the player for a chest (0 for chests without pity). */
export function getPityCounter(player: PlayerRow, chestId: ChestId): number {
  const col = pityColumn(chestId);
  return col ? player[col] : 0;
}

/**
 * Opens `count` (1..BALANCE.chests.maxOpenCount) chests of one type in a single transaction:
 * spends price × count pearls, rolls each chest (pity-aware), updates pity counters, grants every reward.
 * Emits `chest_opened` per chest after commit. Throws ChestError (nothing changed) on bad input / not enough pearls.
 */
export function openChests(ctx: GameContext, userId: string, chestId: ChestId, count = 1): ChestOpenResult {
  const def = getChestDef(chestId);
  if (!Number.isInteger(count) || count < 1 || count > BALANCE.chests.maxOpenCount) {
    throw new ChestError(`Можно открыть от 1 до ${BALANCE.chests.maxOpenCount} сундуков за раз.`);
  }
  const pity = chestPity(def);
  const col = pityColumn(def.id);
  const price = def.price * count;

  const result = ctx.db.transaction((): ChestOpenResult => {
    getOrCreatePlayer(ctx, userId);
    let pearlsLeft: number;
    try {
      pearlsLeft = spendPearls(ctx, userId, price);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new ChestError(`Не хватает жемчуга: нужно 🐚 ${err.required}, у тебя 🐚 ${err.available}.`);
      }
      throw err;
    }

    let counter = col ? requirePlayer(ctx, userId)[col] : 0;
    const owned = new Set(listCosmetics(ctx, userId).map((c) => c.cosmetic_id));
    const rewards: OpenedChestReward[] = [];
    const notices: Notice[] = [];

    for (let n = 0; n < count; n++) {
      const roll = rollChest(def, counter, ctx.rng);
      const loot = resolveLoot(roll.entry, ctx.rng, owned);
      counter = nextPityCounter(def, counter, roll.entry.rarity);
      const gearDup = (loot.reward.gear ?? []).some((g) => hasGear(ctx, userId, g));
      const granted = grantReward(ctx, userId, loot.reward, `chest:${def.id}`);
      for (const c of loot.reward.cosmetics ?? []) owned.add(c);
      notices.push(...granted.notices);
      rewards.push({
        rarity: loot.rarity,
        kind: loot.kind,
        label: gearDup ? `${loot.label} (дубль → 🪙 ${gearDupCoins(loot.reward)})` : loot.label,
        cosmeticType: loot.cosmeticType,
        duplicate: gearDup || loot.duplicate === true,
        forcedByPity: roll.forcedByPity,
        reward: loot.reward,
        summary: granted.summary,
      });
    }

    if (col) updatePlayer(ctx, userId, { [col]: counter });

    return {
      chest: def,
      count,
      pearlsSpent: price,
      pearlsLeft,
      rewards,
      pity: pity ? { counter, left: pityLeft(def, counter)!, opens: pity.opens, minRarity: pity.minRarity } : null,
      notices,
    };
  })();

  const events: GameEvent[] = result.rewards.map((r) => ({ type: 'chest_opened', userId, chestId: def.id, rewardRarity: r.rarity }));
  result.notices.push(...ctx.bus.emitAll(events, ctx));
  return result;
}

/** Coins a duplicate gear reward converts to (grantReward does the conversion). */
function gearDupCoins(reward: Reward): number {
  const def = GEAR_BY_ID[reward.gear?.[0] ?? ''];
  return def ? BALANCE.gearDuplicateCoins[def.tier] : 0;
}

export interface ChestInfo {
  chest: ChestDef;
  pity: { counter: number; left: number; opens: number; minRarity: Rarity } | null;
}

/** Pearls and pity status of a player for every chest (creates the player if missing). */
export function chestStatus(ctx: GameContext, userId: string): { pearls: number; chests: ChestInfo[] } {
  const p = getOrCreatePlayer(ctx, userId);
  const chests = (['wood', 'silver', 'gold'] as ChestId[])
    .map((id) => (CHEST_BY_ID as Partial<Record<string, ChestDef>>)[id])
    .filter((d): d is ChestDef => !!d)
    .map((chest) => {
      const pity = chestPity(chest);
      const counter = getPityCounter(p, chest.id);
      return {
        chest,
        pity: pity ? { counter, left: pityLeft(chest, counter)!, opens: pity.opens, minRarity: pity.minRarity } : null,
      };
    });
  return { pearls: p.pearls, chests };
}
