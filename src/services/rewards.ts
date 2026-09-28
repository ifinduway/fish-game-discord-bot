import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { CONSUMABLE_BY_ID } from '../data/consumables.js';
import { COSMETIC_BY_ID } from '../data/cosmetics.js';
import { GEAR_BY_ID } from '../data/gear.js';
import type { Reward } from '../data/types.js';
import { addConsumable, addCosmetic, addGearItem, hasGear } from '../db/repos/inventory.js';
import { addCoins, addPearls } from '../db/repos/wallet.js';
import { addXp, getOrCreatePlayer } from './player.js';

export type { Reward } from '../data/types.js';

/** Handler for season-pass XP (registered by WP3). Runs inside grantReward's transaction. */
export type PassXpHandler = (ctx: GameContext, userId: string, amount: number, source: string) => Notice[] | void;

let passXpHandler: PassXpHandler | null = null;

/** Registers (replaces) the pass-XP handler. Pass `null` to unregister (tests). */
export function registerPassXpHandler(fn: PassXpHandler | null): void {
  passXpHandler = fn;
}

export interface GrantResult {
  notices: Notice[];
  /** Russian one-line description of what was actually granted (duplicates converted) */
  summary: string;
}

/**
 * Grants a reward bundle atomically (opens a transaction, or a savepoint when already inside one).
 * Unknown item/gear/cosmetic ids throw (whole grant rolls back). Duplicate gear → coins (BALANCE.gearDuplicateCoins[tier]);
 * duplicate cosmetics are ignored. Does NOT update stats counters.
 */
export function grantReward(ctx: GameContext, userId: string, reward: Reward, source: string): GrantResult {
  return ctx.db.transaction((): GrantResult => {
    getOrCreatePlayer(ctx, userId);
    const now = ctx.clock.now();
    const notices: Notice[] = [];
    const parts: string[] = [];

    let coins = Math.max(0, Math.floor(reward.coins ?? 0));
    const gearParts: string[] = [];
    for (const gearId of reward.gear ?? []) {
      const def = GEAR_BY_ID[gearId];
      if (!def) throw new Error(`grantReward: unknown gear id '${gearId}'`);
      if (hasGear(ctx, userId, gearId)) {
        const dup = BALANCE.gearDuplicateCoins[def.tier];
        coins += dup;
        gearParts.push(`${def.emoji} ${def.name} (дубль → 🪙 ${dup})`);
      } else {
        addGearItem(ctx, userId, gearId, now);
        gearParts.push(`${def.emoji} ${def.name}`);
      }
    }

    const pearls = Math.max(0, Math.floor(reward.pearls ?? 0));
    if (coins > 0) addCoins(ctx, userId, coins);
    if (pearls > 0) addPearls(ctx, userId, pearls);
    if ((reward.coins ?? 0) > 0) parts.push(`🪙 ${Math.floor(reward.coins!)}`);
    if (pearls > 0) parts.push(`🐚 ${pearls}`);

    for (const { itemId, qty } of reward.items ?? []) {
      const def = CONSUMABLE_BY_ID[itemId];
      if (!def) throw new Error(`grantReward: unknown item id '${itemId}'`);
      if (qty <= 0) continue;
      addConsumable(ctx, userId, itemId, qty);
      parts.push(`${def.emoji} ${def.name} ×${qty}`);
    }

    parts.push(...gearParts);

    for (const cosmeticId of reward.cosmetics ?? []) {
      const def = COSMETIC_BY_ID[cosmeticId];
      if (!def) throw new Error(`grantReward: unknown cosmetic id '${cosmeticId}'`);
      const isNew = addCosmetic(ctx, userId, cosmeticId, now, source);
      if (isNew) parts.push(`${COSMETIC_TYPE_EMOJI[def.type]} ${def.name}`);
    }

    const xp = Math.max(0, Math.floor(reward.xp ?? 0));
    if (xp > 0) {
      parts.push(`✨ ${xp} XP`);
      notices.push(...addXp(ctx, userId, xp).notices);
    }

    const passXp = Math.max(0, Math.floor(reward.passXp ?? 0));
    if (passXp > 0) {
      parts.push(`🎫 ${passXp} XP пасса`);
      if (passXpHandler) {
        const out = passXpHandler(ctx, userId, passXp, source);
        if (Array.isArray(out)) notices.push(...out);
      }
    }

    return { notices, summary: parts.length > 0 ? parts.join(' · ') : 'ничего' };
  })();
}

const COSMETIC_TYPE_EMOJI = { title: '🏷️', frame: '🖼️', background: '🌄', badge: '🎖️' } as const;

/** Russian one-line description, e.g. "🪙 120 · 🐚 5 · 🥤 Энергетик ×1". Unknown ids are shown raw. */
export function formatReward(reward: Reward): string {
  const parts: string[] = [];
  if (reward.coins) parts.push(`🪙 ${reward.coins}`);
  if (reward.pearls) parts.push(`🐚 ${reward.pearls}`);
  for (const { itemId, qty } of reward.items ?? []) {
    const def = CONSUMABLE_BY_ID[itemId];
    parts.push(def ? `${def.emoji} ${def.name} ×${qty}` : `🎁 ${itemId} ×${qty}`);
  }
  for (const gearId of reward.gear ?? []) {
    const def = GEAR_BY_ID[gearId];
    parts.push(def ? `${def.emoji} ${def.name}` : `🎣 ${gearId}`);
  }
  for (const id of reward.cosmetics ?? []) {
    const def = COSMETIC_BY_ID[id];
    parts.push(def ? `${COSMETIC_TYPE_EMOJI[def.type]} ${def.name}` : `🎖️ ${id}`);
  }
  if (reward.xp) parts.push(`✨ ${reward.xp} XP`);
  if (reward.passXp) parts.push(`🎫 ${reward.passXp} XP пасса`);
  return parts.length > 0 ? parts.join(' · ') : 'ничего';
}

/** Sums several rewards into one bundle. */
export function mergeRewards(...rewards: Reward[]): Reward {
  const out: Reward = {};
  for (const r of rewards) {
    if (r.coins) out.coins = (out.coins ?? 0) + r.coins;
    if (r.pearls) out.pearls = (out.pearls ?? 0) + r.pearls;
    if (r.xp) out.xp = (out.xp ?? 0) + r.xp;
    if (r.passXp) out.passXp = (out.passXp ?? 0) + r.passXp;
    if (r.items?.length) out.items = [...(out.items ?? []), ...r.items];
    if (r.gear?.length) out.gear = [...(out.gear ?? []), ...r.gear];
    if (r.cosmetics?.length) out.cosmetics = [...(out.cosmetics ?? []), ...r.cosmetics];
  }
  return out;
}
